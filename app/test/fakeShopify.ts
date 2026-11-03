import {
  ShopifyUserError,
  type ShopifyGateway,
  type ShopifyOrderState,
} from "../sync/gateway";
import {
  sellingPlanInput,
  type DesiredPlan,
  type ShopifyPlan,
} from "../sync/plans";

// En Shopify i hukommelsen til tests. Den opfører sig som det rigtige API
// på de punkter, synkroniseringen afhænger af, og logger hver skrivning.

type Variant = {
  productId: string;
  inventoryItemId: string;
  inventoryPolicy: string;
  tracked: boolean;
  available: number | null;
};

type Group = { id: string; variantIds: Set<string>; plans: ShopifyPlan[] };

export type Write = { method: string; args: unknown[] };

export function createFakeShopify() {
  let nextId = 1;
  const variants = new Map<string, Variant>();
  const groups = new Map<string, Group>();
  const writes: Write[] = [];
  /** requiresSellingPlan pr. produkt. */
  const products = new Map<string, { requiresSellingPlan: boolean }>();
  const failures = new Map<string, string>();

  const id = (type: string) => `gid://shopify/${type}/${nextId++}`;

  function toShopifyPlan(plan: DesiredPlan): ShopifyPlan {
    const input = sellingPlanInput(plan);
    return {
      id: id("SellingPlan"),
      options: input.options,
      category: input.category,
      reserve: input.inventoryPolicy.reserve,
      billing: {
        remainingBalanceChargeTrigger:
          input.billingPolicy.fixed.remainingBalanceChargeTrigger,
        checkoutChargeType: input.billingPolicy.fixed.checkoutCharge.type,
        checkoutChargePercentage:
          input.billingPolicy.fixed.checkoutCharge.value.percentage,
      },
      delivery: {
        fulfillmentTrigger: input.deliveryPolicy.fixed.fulfillmentTrigger,
        fulfillmentExactTime: input.deliveryPolicy.fixed.fulfillmentExactTime,
      },
      pricingPolicyCount: 0,
    };
  }

  function write(method: string, args: unknown[]) {
    const message = failures.get(method);
    if (message) {
      failures.delete(method);
      throw new ShopifyUserError(method, [{ message }]);
    }
    writes.push({ method, args });
  }

  function addPlans(group: Group, plans: DesiredPlan[]) {
    const created = plans.map(toShopifyPlan);
    for (const plan of created) {
      // Som i Shopify: options skal være unikke inden for gruppen.
      if (group.plans.some((p) => p.options[0] === plan.options[0])) {
        throw new ShopifyUserError("createPlans", [
          { message: "Selling plan options must be unique" },
        ]);
      }
      group.plans.push(plan);
    }
    return created.map((plan) => ({ id: plan.id, option: plan.options[0] }));
  }

  const orders = new Map<string, ShopifyOrderState>();

  const gateway: ShopifyGateway = {
    async readOrder(orderId) {
      const order = orders.get(orderId);
      return order ? structuredClone(order) : null;
    },
    async setOrderMetafields(orderId, fields) {
      write("setOrderMetafields", [orderId, fields]);
      const order = orders.get(orderId)!;
      for (const field of fields) order.metafields[field.key] = field.value;
    },
    async addOrderTags(orderId, tags) {
      write("addOrderTags", [orderId, tags]);
      const order = orders.get(orderId)!;
      for (const tag of tags)
        if (!order.tags.includes(tag)) order.tags.push(tag);
    },
    async removeOrderTags(orderId, tags) {
      write("removeOrderTags", [orderId, tags]);
      const order = orders.get(orderId)!;
      order.tags = order.tags.filter((tag) => !tags.includes(tag));
    },
    async read({ variantId, groupId, locationId }) {
      const variant = variants.get(variantId);
      const group = groupId ? groups.get(groupId) : undefined;
      return {
        variant: variant
          ? {
              productId: variant.productId,
              productRequiresSellingPlan:
                products.get(variant.productId)?.requiresSellingPlan ?? false,
              productVariantIds: [...variants.entries()]
                .filter(([, v]) => v.productId === variant.productId)
                .map(([vid]) => vid),
              inventoryPolicy: variant.inventoryPolicy,
              tracked: variant.tracked,
              available: locationId ? variant.available : null,
            }
          : null,
        group: group
          ? {
              id: group.id,
              appliesToVariant: group.variantIds.has(variantId),
              plans: group.plans.map((plan) => ({ ...plan })),
            }
          : null,
      };
    },
    async createGroup({ variantId, merchantCode, plans }) {
      write("createGroup", [variantId, merchantCode, plans]);
      const group: Group = {
        id: id("SellingPlanGroup"),
        variantIds: new Set([variantId]),
        plans: [],
      };
      groups.set(group.id, group);
      return { groupId: group.id, plans: addPlans(group, plans) };
    },
    async createPlans(groupId, plans) {
      write("createPlans", [groupId, plans]);
      return addPlans(groups.get(groupId)!, plans);
    },
    async deletePlans(groupId, planIds) {
      write("deletePlans", [groupId, planIds]);
      const group = groups.get(groupId)!;
      group.plans = group.plans.filter((plan) => !planIds.includes(plan.id));
    },
    async deleteGroup(groupId) {
      write("deleteGroup", [groupId]);
      groups.delete(groupId);
    },
    async addVariant(groupId, variantId) {
      write("addVariant", [groupId, variantId]);
      groups.get(groupId)!.variantIds.add(variantId);
    },
    async removeVariant(groupId, variantId) {
      write("removeVariant", [groupId, variantId]);
      groups.get(groupId)!.variantIds.delete(variantId);
    },
    async enforceInventoryTracking(productId, variantId) {
      write("enforceInventoryTracking", [productId, variantId]);
      const variant = variants.get(variantId)!;
      variant.tracked = true;
      variant.inventoryPolicy = "DENY";
    },
    async setProductRequiresSellingPlan(productId, requiresSellingPlan) {
      write("setProductRequiresSellingPlan", [productId, requiresSellingPlan]);
      products.set(productId, { requiresSellingPlan });
    },
    async setAvailable({ inventoryItemId, locationId, quantity, changeFrom }) {
      write("setAvailable", [
        inventoryItemId,
        locationId,
        quantity,
        changeFrom,
      ]);
      const variant = [...variants.values()].find(
        (v) => v.inventoryItemId === inventoryItemId,
      )!;
      if (variant.available !== changeFrom) {
        throw new ShopifyUserError("setAvailable", [
          { message: "The quantity couldn't be updated because it changed." },
        ]);
      }
      variant.available = quantity;
    },
  };

  return {
    gateway,
    writes,
    orders,
    products,
    /** Opretter eller erstatter en ordre i den simulerede Shopify. */
    putOrder(snapshot: ShopifyOrderState["snapshot"]) {
      const existing = orders.get(snapshot.id);
      orders.set(snapshot.id, {
        snapshot: structuredClone(snapshot),
        tags: existing?.tags ?? [],
        metafields: existing?.metafields ?? {},
      });
    },
    groups,
    variants,
    addVariant(variantId: string, state: Partial<Variant> = {}) {
      variants.set(variantId, {
        productId: "gid://shopify/Product/1",
        inventoryItemId: "gid://shopify/InventoryItem/1",
        inventoryPolicy: "CONTINUE",
        tracked: false,
        available: 0,
        ...state,
      });
    },
    /** Næste kald til `method` fejler med denne userError. */
    failNext(method: keyof ShopifyGateway, message: string) {
      failures.set(method, message);
    },
    clearWrites() {
      writes.length = 0;
    },
  };
}
