import { randomUUID } from "node:crypto";
import {
  GROUP_NAME,
  GROUP_OPTION,
  sellingPlanInput,
  type DesiredPlan,
  type ShopifyPlan,
} from "./plans";
import { ShopifyUserError, type ShopifyGateway } from "./gateway";

// Den rigtige forbindelse til Shopify Admin API. Her ligger appens eneste
// mutationer. Brug den kun gennem syncVariant().

type AdminGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

type UserErrors = { field?: string[] | null; message: string }[];

/** Seneste afviste opkrævning (salg/træk), eller null. */
export function latestFailedCharge(
  transactions: { kind: string; status: string; createdAt: string }[],
) {
  const failed = transactions
    .filter(
      (t) =>
        (t.kind === "SALE" ||
          t.kind === "CAPTURE" ||
          t.kind === "AUTHORIZATION") &&
        (t.status === "FAILURE" || t.status === "ERROR"),
    )
    .map((t) => t.createdAt)
    .sort();
  return failed.pop() ?? null;
}

function alreadyCancelled(error: { code: string | null; message: string }) {
  return /already.*cancel|cancel.*already/i.test(error.message);
}

async function run<T>(
  graphql: AdminGraphql,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await graphql(query, { variables });
  const json = (await response.json()) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (json.errors?.length) {
    throw new Error(
      `Shopify afviste forespørgslen: ${json.errors.map((e) => e.message).join("; ")}`,
    );
  }
  if (!json.data) throw new Error("Shopify svarede uden data.");
  return json.data;
}

function check(action: string, userErrors: UserErrors | undefined) {
  if (userErrors && userErrors.length > 0) {
    throw new ShopifyUserError(action, userErrors);
  }
}

const PLAN_FIELDS = `#graphql
  fragment PreauraPlan on SellingPlan {
    id
    options
    category
    inventoryPolicy {
      reserve
    }
    billingPolicy {
      ... on SellingPlanFixedBillingPolicy {
        remainingBalanceChargeTrigger
        checkoutCharge {
          type
          value {
            ... on SellingPlanCheckoutChargePercentageValue {
              percentage
            }
          }
        }
      }
    }
    deliveryPolicy {
      ... on SellingPlanFixedDeliveryPolicy {
        fulfillmentTrigger
        fulfillmentExactTime
      }
    }
    pricingPolicies {
      __typename
    }
  }`;

type PlanNode = {
  id: string;
  options: string[];
  category: string | null;
  inventoryPolicy: { reserve: string } | null;
  billingPolicy: {
    remainingBalanceChargeTrigger?: string;
    checkoutCharge?: { type: string; value: { percentage?: number } };
  };
  deliveryPolicy: {
    fulfillmentTrigger?: string;
    fulfillmentExactTime?: string | null;
  };
  pricingPolicies: unknown[];
};

function toPlan(node: PlanNode): ShopifyPlan {
  const billing = node.billingPolicy;
  const delivery = node.deliveryPolicy;
  return {
    id: node.id,
    options: node.options,
    category: node.category,
    reserve: node.inventoryPolicy?.reserve ?? null,
    billing: billing.remainingBalanceChargeTrigger
      ? {
          remainingBalanceChargeTrigger: billing.remainingBalanceChargeTrigger,
          checkoutChargeType: billing.checkoutCharge?.type ?? "",
          checkoutChargePercentage:
            billing.checkoutCharge?.value.percentage ?? null,
        }
      : null,
    delivery: delivery.fulfillmentTrigger
      ? {
          fulfillmentTrigger: delivery.fulfillmentTrigger,
          fulfillmentExactTime: delivery.fulfillmentExactTime ?? null,
        }
      : null,
    pricingPolicyCount: node.pricingPolicies.length,
  };
}

const READ_QUERY = `#graphql
  ${PLAN_FIELDS}
  query PreauraSyncState(
    $variantId: ID!
    $groupId: ID!
    $hasGroup: Boolean!
    $locationId: ID!
    $hasLocation: Boolean!
  ) {
    productVariant(id: $variantId) {
      id
      inventoryPolicy
      product {
        id
        requiresSellingPlan
        variants(first: 250) {
          nodes {
            id
          }
        }
      }
      preorderMetafield: metafield(namespace: "preaura", key: "preorder") {
        value
      }
      inventoryItem {
        tracked
        inventoryLevel(locationId: $locationId) @include(if: $hasLocation) {
          quantities(names: ["available"]) {
            name
            quantity
          }
        }
      }
    }
    sellingPlanGroup(id: $groupId) @include(if: $hasGroup) {
      id
      appliesToProductVariant(productVariantId: $variantId)
      sellingPlans(first: 100) {
        nodes {
          ...PreauraPlan
        }
      }
    }
  }`;

const CREATED_PLANS = `
  sellingPlans(first: 100) {
    nodes {
      id
      options
    }
  }`;

export function createShopifyGateway(graphql: AdminGraphql): ShopifyGateway {
  return {
    async read({ variantId, groupId, locationId }) {
      const data = await run<{
        productVariant: {
          inventoryPolicy: string;
          preorderMetafield: { value: string } | null;
          product: {
            id: string;
            requiresSellingPlan: boolean;
            variants: { nodes: { id: string }[] };
          };
          inventoryItem: {
            tracked: boolean;
            inventoryLevel?: {
              quantities: { name: string; quantity: number }[];
            } | null;
          };
        } | null;
        sellingPlanGroup?: {
          id: string;
          appliesToProductVariant: boolean;
          sellingPlans: { nodes: PlanNode[] };
        } | null;
      }>(graphql, READ_QUERY, {
        variantId,
        groupId: groupId ?? "gid://shopify/SellingPlanGroup/0",
        hasGroup: groupId != null,
        locationId: locationId ?? "gid://shopify/Location/0",
        hasLocation: locationId != null,
      });

      const variant = data.productVariant;
      const level = variant?.inventoryItem.inventoryLevel;
      const group = data.sellingPlanGroup;
      return {
        variant: variant
          ? {
              productId: variant.product.id,
              productRequiresSellingPlan: variant.product.requiresSellingPlan,
              productVariantIds: variant.product.variants.nodes.map(
                (v) => v.id,
              ),
              preorderMetafield: variant.preorderMetafield?.value ?? null,
              inventoryPolicy: variant.inventoryPolicy,
              tracked: variant.inventoryItem.tracked,
              available:
                level?.quantities.find((q) => q.name === "available")
                  ?.quantity ?? null,
            }
          : null,
        group: group
          ? {
              id: group.id,
              appliesToVariant: group.appliesToProductVariant,
              plans: group.sellingPlans.nodes.map(toPlan),
            }
          : null,
      };
    },

    async createGroup({ variantId, merchantCode, plans }) {
      const data = await run<{
        sellingPlanGroupCreate: {
          sellingPlanGroup: {
            id: string;
            sellingPlans: { nodes: { id: string; options: string[] }[] };
          } | null;
          userErrors: UserErrors;
        };
      }>(
        graphql,
        `#graphql
          mutation PreauraCreateGroup(
            $input: SellingPlanGroupInput!
            $resources: SellingPlanGroupResourceInput
          ) {
            sellingPlanGroupCreate(input: $input, resources: $resources) {
              sellingPlanGroup {
                id
                ${CREATED_PLANS}
              }
              userErrors {
                field
                message
              }
            }
          }`,
        {
          input: {
            name: GROUP_NAME,
            merchantCode,
            options: [GROUP_OPTION],
            sellingPlansToCreate: plans.map(sellingPlanInput),
          },
          resources: { productVariantIds: [variantId] },
        },
      );
      const payload = data.sellingPlanGroupCreate;
      check("Oprettelse af selling plan group", payload.userErrors);
      if (!payload.sellingPlanGroup) {
        throw new Error("Shopify oprettede ikke selling plan-gruppen.");
      }
      return {
        groupId: payload.sellingPlanGroup.id,
        plans: payload.sellingPlanGroup.sellingPlans.nodes.map((plan) => ({
          id: plan.id,
          option: plan.options[0] ?? "",
        })),
      };
    },

    async createPlans(groupId, plans: DesiredPlan[]) {
      const data = await run<{
        sellingPlanGroupUpdate: {
          sellingPlanGroup: {
            sellingPlans: { nodes: { id: string; options: string[] }[] };
          } | null;
          userErrors: UserErrors;
        };
      }>(
        graphql,
        `#graphql
          mutation PreauraCreatePlans($id: ID!, $input: SellingPlanGroupInput!) {
            sellingPlanGroupUpdate(id: $id, input: $input) {
              sellingPlanGroup {
                ${CREATED_PLANS}
              }
              userErrors {
                field
                message
              }
            }
          }`,
        // Kun sellingPlansToCreate. sellingPlansToUpdate bruges aldrig.
        {
          id: groupId,
          input: { sellingPlansToCreate: plans.map(sellingPlanInput) },
        },
      );
      const payload = data.sellingPlanGroupUpdate;
      check("Oprettelse af selling plan", payload.userErrors);
      return (payload.sellingPlanGroup?.sellingPlans.nodes ?? []).map(
        (plan) => ({
          id: plan.id,
          option: plan.options[0] ?? "",
        }),
      );
    },

    async deletePlans(groupId, planIds) {
      const data = await run<{
        sellingPlanGroupUpdate: { userErrors: UserErrors };
      }>(
        graphql,
        `#graphql
          mutation PreauraRetirePlans($id: ID!, $input: SellingPlanGroupInput!) {
            sellingPlanGroupUpdate(id: $id, input: $input) {
              deletedSellingPlanIds
              userErrors {
                field
                message
              }
            }
          }`,
        { id: groupId, input: { sellingPlansToDelete: planIds } },
      );
      check(
        "Udfasning af selling plan",
        data.sellingPlanGroupUpdate.userErrors,
      );
    },

    async deleteGroup(groupId) {
      const data = await run<{
        sellingPlanGroupDelete: { userErrors: UserErrors };
      }>(
        graphql,
        `#graphql
          mutation PreauraDeleteGroup($id: ID!) {
            sellingPlanGroupDelete(id: $id) {
              deletedSellingPlanGroupId
              userErrors {
                field
                message
              }
            }
          }`,
        { id: groupId },
      );
      check(
        "Sletning af selling plan group",
        data.sellingPlanGroupDelete.userErrors,
      );
    },

    async addVariant(groupId, variantId) {
      const data = await run<{
        sellingPlanGroupAddProductVariants: { userErrors: UserErrors };
      }>(
        graphql,
        `#graphql
          mutation PreauraAddVariant($id: ID!, $variantIds: [ID!]!) {
            sellingPlanGroupAddProductVariants(id: $id, productVariantIds: $variantIds) {
              userErrors {
                field
                message
              }
            }
          }`,
        { id: groupId, variantIds: [variantId] },
      );
      check(
        "Tilknytning af variant til selling plan group",
        data.sellingPlanGroupAddProductVariants.userErrors,
      );
    },

    async removeVariant(groupId, variantId) {
      const data = await run<{
        sellingPlanGroupRemoveProductVariants: { userErrors: UserErrors };
      }>(
        graphql,
        `#graphql
          mutation PreauraRemoveVariant($id: ID!, $variantIds: [ID!]!) {
            sellingPlanGroupRemoveProductVariants(id: $id, productVariantIds: $variantIds) {
              removedProductVariantIds
              userErrors {
                field
                message
              }
            }
          }`,
        { id: groupId, variantIds: [variantId] },
      );
      check(
        "Fjernelse af variant fra selling plan group",
        data.sellingPlanGroupRemoveProductVariants.userErrors,
      );
    },

    async enforceInventoryTracking(productId, variantId) {
      const data = await run<{
        productVariantsBulkUpdate: { userErrors: UserErrors };
      }>(
        graphql,
        `#graphql
          mutation PreauraTrackInventory(
            $productId: ID!
            $variants: [ProductVariantsBulkInput!]!
          ) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              userErrors {
                field
                message
              }
            }
          }`,
        {
          productId,
          // Kun lagersporing og inventory policy. Intet andet på varianten.
          variants: [
            {
              id: variantId,
              inventoryPolicy: "DENY",
              inventoryItem: { tracked: true },
            },
          ],
        },
      );
      check(
        "Opsætning af lagersporing",
        data.productVariantsBulkUpdate.userErrors,
      );
    },

    async readOrder(orderId) {
      const data = await run<{
        order: {
          id: string;
          name: string;
          createdAt: string;
          cancelledAt: string | null;
          tags: string[];
          fullyPaid: boolean;
          transactions: { kind: string; status: string; createdAt: string }[];
          lineItems: {
            nodes: {
              id: string;
              currentQuantity: number;
              unfulfilledQuantity: number;
              title: string;
              variantTitle: string | null;
              variant: { id: string } | null;
              sellingPlan: { sellingPlanId: string | null } | null;
            }[];
          };
          promisedDate: { value: string } | null;
          allocations: { value: string } | null;
          cancelUrl: { value: string } | null;
        } | null;
      }>(
        graphql,
        `#graphql
          query PreauraOrder($id: ID!) {
            order(id: $id) {
              id
              name
              createdAt
              cancelledAt
              tags
              fullyPaid
              transactions(first: 50) {
                kind
                status
                createdAt
              }
              lineItems(first: 250) {
                nodes {
                  id
                  currentQuantity
                  unfulfilledQuantity
                  title
                  variantTitle
                  variant {
                    id
                  }
                  sellingPlan {
                    sellingPlanId
                  }
                }
              }
              promisedDate: metafield(namespace: "preaura", key: "promised_date") {
                value
              }
              allocations: metafield(namespace: "preaura", key: "allocations") {
                value
              }
              cancelUrl: metafield(namespace: "preaura", key: "cancel_url") {
                value
              }
            }
          }`,
        { id: orderId },
      );
      const order = data.order;
      if (!order) return null;
      return {
        snapshot: {
          id: order.id,
          name: order.name,
          createdAt: order.createdAt,
          cancelled: order.cancelledAt != null,
          lines: order.lineItems.nodes.map((line) => ({
            id: line.id,
            variantId: line.variant?.id ?? null,
            sellingPlanId: line.sellingPlan?.sellingPlanId ?? null,
            quantity: line.currentQuantity,
            unfulfilled: line.unfulfilledQuantity,
            title: line.title,
            variantTitle: line.variantTitle,
          })),
          payment: {
            paid: order.fullyPaid,
            failedAt: latestFailedCharge(order.transactions),
          },
        },
        tags: order.tags,
        metafields: {
          promised_date: order.promisedDate?.value ?? null,
          allocations: order.allocations?.value ?? null,
          cancel_url: order.cancelUrl?.value ?? null,
        },
      };
    },

    async readOrderDetails(orderId) {
      type Line = {
        id: string;
        sku: string | null;
        title: string;
        variantTitle: string | null;
        product: { id: string; title: string } | null;
      };
      type Data = {
        order: {
          name: string;
          email?: string | null;
          customer?: {
            firstName: string | null;
            lastName: string | null;
          } | null;
          lineItems: { nodes: Line[] };
        } | null;
      };
      const lineFields = `lineItems(first: 250) {
                nodes {
                  id
                  sku
                  title
                  variantTitle
                  product {
                    id
                    title
                  }
                }
              }`;
      // Kundens navn og e-mail er beskyttede kundedata. Har appen ikke fået
      // adgang til dem, afviser Shopify hele forespørgslen — så hentes ordren
      // igen uden, og hændelsen sendes uden kunde. Afvisningen kan komme som
      // «errors» i svaret eller som en fejl, Shopifys bibliotek kaster.
      const denied = (message: string, code?: string) =>
        code === "ACCESS_DENIED" ||
        // Fx «This app is not approved to use the email field. See
        // …/protected-customer-data».
        /access denied|not approved|protected[- ]customer[- ]data/i.test(
          message,
        );
      let json: {
        data?: Data;
        errors?: { message: string; extensions?: { code?: string } }[];
      };
      try {
        const response = await graphql(
          `#graphql
            query PreauraOrderDetails($id: ID!) {
              order(id: $id) {
                name
                email
                customer {
                  firstName
                  lastName
                }
                ${lineFields}
              }
            }`,
          { variables: { id: orderId } },
        );
        json = (await response.json()) as typeof json;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!denied(message)) throw error;
        json = { errors: [{ message }] };
      }
      let data = json.data;
      let withCustomer = true;
      if (json.errors?.length) {
        if (!json.errors.every((e) => denied(e.message, e.extensions?.code))) {
          throw new Error(
            `Shopify afviste forespørgslen: ${json.errors.map((e) => e.message).join("; ")}`,
          );
        }
        withCustomer = false;
        data = await run<Data>(
          graphql,
          `#graphql
            query PreauraOrderDetailsWithoutCustomer($id: ID!) {
              order(id: $id) {
                name
                ${lineFields}
              }
            }`,
          { id: orderId },
        );
      }
      const order = data?.order;
      if (!order) return null;
      return {
        name: order.name,
        customer: withCustomer
          ? {
              email: order.email ?? null,
              firstName: order.customer?.firstName ?? null,
              lastName: order.customer?.lastName ?? null,
            }
          : null,
        lines: order.lineItems.nodes.map((line) => ({
          id: line.id,
          productId: line.product?.id ?? null,
          productTitle: line.product?.title ?? line.title,
          variantTitle: line.variantTitle,
          sku: line.sku,
        })),
      };
    },

    async readVariantDetails(variantId) {
      const data = await run<{
        productVariant: {
          title: string | null;
          sku: string | null;
          product: { id: string; title: string };
        } | null;
      }>(
        graphql,
        `#graphql
          query PreauraVariantDetails($id: ID!) {
            productVariant(id: $id) {
              title
              sku
              product {
                id
                title
              }
            }
          }`,
        { id: variantId },
      );
      const variant = data.productVariant;
      if (!variant) return null;
      return {
        productId: variant.product.id,
        productTitle: variant.product.title,
        variantTitle: variant.title,
        sku: variant.sku,
      };
    },

    async readVariantAvailability(variantIds) {
      const result = new Map<
        string,
        { available: boolean; quantity: number | null; productId: string }
      >();
      for (let i = 0; i < variantIds.length; i += 250) {
        const data = await run<{
          nodes: ({
            id: string;
            availableForSale: boolean;
            inventoryQuantity: number | null;
            inventoryItem: { tracked: boolean } | null;
            product: { id: string };
          } | null)[];
        }>(
          graphql,
          `#graphql
            query PreauraVariantAvailability($ids: [ID!]!) {
              nodes(ids: $ids) {
                ... on ProductVariant {
                  id
                  availableForSale
                  inventoryQuantity
                  inventoryItem {
                    tracked
                  }
                  product {
                    id
                  }
                }
              }
            }`,
          { ids: variantIds.slice(i, i + 250) },
        );
        for (const node of data.nodes) {
          if (!node?.id) continue;
          result.set(node.id, {
            available: node.availableForSale,
            quantity:
              node.inventoryItem?.tracked === false
                ? null
                : node.inventoryQuantity,
            productId: node.product.id,
          });
        }
      }
      return result;
    },

    async cancelOrder(orderId, reason) {
      const data = await run<{
        orderCancel: {
          orderCancelUserErrors: { code: string | null; message: string }[];
        };
      }>(
        graphql,
        `#graphql
          mutation PreauraOrderCancel(
            $orderId: ID!
            $reason: OrderCancelReason!
            $staffNote: String
          ) {
            orderCancel(
              orderId: $orderId
              reason: $reason
              restock: false
              notifyCustomer: false
              staffNote: $staffNote
            ) {
              orderCancelUserErrors {
                code
                message
              }
            }
          }`,
        {
          orderId,
          reason,
          staffNote:
            "Annulleret af PREAURA. Intet er refunderet — refundér i Shopify, hvis kunden har betalt.",
        },
      );
      const errors = data.orderCancel.orderCancelUserErrors;
      // Allerede annulleret: det ønskede er sket.
      if (errors.length > 0 && !errors.every(alreadyCancelled)) {
        throw new ShopifyUserError("Annullering af ordren", errors);
      }
    },

    async setOrderLineQuantities(orderId, targets) {
      const begin = await run<{
        orderEditBegin: {
          calculatedOrder: {
            id: string;
            lineItems: {
              nodes: {
                id: string;
                quantity: number;
                editableQuantity: number;
              }[];
            };
          } | null;
          userErrors: UserErrors;
        };
      }>(
        graphql,
        `#graphql
          mutation PreauraOrderEditBegin($id: ID!) {
            orderEditBegin(id: $id) {
              calculatedOrder {
                id
                lineItems(first: 250) {
                  nodes {
                    id
                    quantity
                    editableQuantity
                  }
                }
              }
              userErrors {
                field
                message
              }
            }
          }`,
        { id: orderId },
      );
      check("Rettelse af ordren", begin.orderEditBegin.userErrors);
      const calculated = begin.orderEditBegin.calculatedOrder;
      if (!calculated)
        throw new Error("Shopify startede ikke en rettelse af ordren.");
      // En beregnet linje har samme nummer som ordrelinjen.
      const byNumber = new Map(
        calculated.lineItems.nodes.map((l) => [l.id.split("/").pop()!, l]),
      );
      let changed = false;
      for (const target of targets) {
        const line = byNumber.get(target.lineId.split("/").pop()!);
        if (!line) throw new Error(`Ordrelinjen ${target.lineId} findes ikke.`);
        if (line.quantity <= target.quantity) continue; // Allerede sket.
        const set = await run<{
          orderEditSetQuantity: { userErrors: UserErrors };
        }>(
          graphql,
          `#graphql
            mutation PreauraOrderEditSetQuantity(
              $id: ID!
              $lineItemId: ID!
              $quantity: Int!
            ) {
              orderEditSetQuantity(
                id: $id
                lineItemId: $lineItemId
                quantity: $quantity
                restock: false
              ) {
                userErrors {
                  field
                  message
                }
              }
            }`,
          { id: calculated.id, lineItemId: line.id, quantity: target.quantity },
        );
        check("Rettelse af antal", set.orderEditSetQuantity.userErrors);
        changed = true;
      }
      if (!changed) return;
      const commit = await run<{ orderEditCommit: { userErrors: UserErrors } }>(
        graphql,
        `#graphql
          mutation PreauraOrderEditCommit($id: ID!, $staffNote: String) {
            orderEditCommit(id: $id, notifyCustomer: false, staffNote: $staffNote) {
              userErrors {
                field
                message
              }
            }
          }`,
        {
          id: calculated.id,
          staffNote:
            "Antal nedsat af PREAURA (annullering). Intet er refunderet — refundér i Shopify, hvis kunden har betalt.",
        },
      );
      check("Rettelse af ordren", commit.orderEditCommit.userErrors);
    },

    async flowTriggerReceive(handle, payload) {
      const data = await run<{
        flowTriggerReceive: { userErrors: UserErrors };
      }>(
        graphql,
        `#graphql
          mutation PreauraFlowTrigger($handle: String, $payload: JSON) {
            flowTriggerReceive(handle: $handle, payload: $payload) {
              userErrors {
                field
                message
              }
            }
          }`,
        { handle, payload },
      );
      check("Shopify Flow", data.flowTriggerReceive.userErrors);
    },

    async setOrderMetafields(orderId, fields) {
      const data = await run<{
        metafieldsSet: { userErrors: UserErrors };
      }>(
        graphql,
        `#graphql
          mutation PreauraOrderMetafields($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              userErrors {
                field
                message
              }
            }
          }`,
        {
          metafields: fields.map((field) => ({
            ownerId: orderId,
            namespace: "preaura",
            key: field.key,
            type: field.type,
            value: field.value,
          })),
        },
      );
      check("Metafelter på ordren", data.metafieldsSet.userErrors);
    },

    async setVariantPreorderMetafield(variantId, value) {
      const data = await run<{
        metafieldsSet: { userErrors: UserErrors };
      }>(
        graphql,
        `#graphql
          mutation PreauraVariantMetafield($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              userErrors {
                field
                message
              }
            }
          }`,
        {
          metafields: [
            {
              ownerId: variantId,
              namespace: "preaura",
              key: "preorder",
              type: "json",
              value,
            },
          ],
        },
      );
      check("Metafelt på varianten", data.metafieldsSet.userErrors);
    },

    async addOrderTags(orderId, tags) {
      const data = await run<{ tagsAdd: { userErrors: UserErrors } }>(
        graphql,
        `#graphql
          mutation PreauraAddOrderTags($id: ID!, $tags: [String!]!) {
            tagsAdd(id: $id, tags: $tags) {
              userErrors {
                field
                message
              }
            }
          }`,
        { id: orderId, tags },
      );
      check("Tag på ordren", data.tagsAdd.userErrors);
    },

    async removeOrderTags(orderId, tags) {
      const data = await run<{ tagsRemove: { userErrors: UserErrors } }>(
        graphql,
        `#graphql
          mutation PreauraRemoveOrderTags($id: ID!, $tags: [String!]!) {
            tagsRemove(id: $id, tags: $tags) {
              userErrors {
                field
                message
              }
            }
          }`,
        { id: orderId, tags },
      );
      check("Fjernelse af tag fra ordren", data.tagsRemove.userErrors);
    },

    async setProductRequiresSellingPlan(productId, requiresSellingPlan) {
      const data = await run<{
        productUpdate: { userErrors: UserErrors };
      }>(
        graphql,
        `#graphql
          mutation PreauraRequireSellingPlan($product: ProductUpdateInput!) {
            productUpdate(product: $product) {
              userErrors {
                field
                message
              }
            }
          }`,
        // Kun requiresSellingPlan. Intet andet på produktet.
        { product: { id: productId, requiresSellingPlan } },
      );
      check(
        "Krav om forudbestilling på produktet",
        data.productUpdate.userErrors,
      );
    },

    async setAvailable({ inventoryItemId, locationId, quantity, changeFrom }) {
      const data = await run<{
        inventorySetQuantities: { userErrors: UserErrors };
      }>(
        graphql,
        `#graphql
          mutation PreauraSetAvailable(
            $input: InventorySetQuantitiesInput!
            $idempotencyKey: String!
          ) {
            inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
              userErrors {
                field
                message
              }
            }
          }`,
        {
          input: {
            name: "available",
            reason: "correction",
            referenceDocumentUri: "preaura://sync",
            quantities: [
              // changeFromQuantity: Shopify afviser, hvis antallet er ændret
              // siden vi læste det (fx af en ordre). Så prøves der igen.
              {
                inventoryItemId,
                locationId,
                quantity,
                changeFromQuantity: changeFrom,
              },
            ],
          },
          idempotencyKey: randomUUID(),
        },
      );
      check("Opdatering af lagerantal", data.inventorySetQuantities.userErrors);
    },
  };
}
