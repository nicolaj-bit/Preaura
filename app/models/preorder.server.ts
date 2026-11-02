import type { Prisma, PrismaClient } from "@prisma/client";
import db from "../db.server";
import {
  allocatedQuantity,
  deliveryState,
  findActiveDelivery,
  remainingQuantity,
  validateDelivery,
  type DeliveryErrors,
  type DeliveryInput,
  type DeliveryState,
} from "../lib/deliveries";

// Eneste adgang til ShopSetting, VariantPlan, Delivery og Allocation.
//
// Alt starter med forShop(shop), og hver eneste forespørgsel herinde har
// `shop` i sit where. shop skal komme fra den godkendte Shopify-session
// (session.shop) — aldrig fra en formular eller en URL.

/** En eller flere felter i en leverance er ugyldige. Vises ved felterne. */
export class DeliveryValidationError extends Error {
  constructor(public readonly errors: DeliveryErrors) {
    super("Leverancen er ugyldig.");
    this.name = "DeliveryValidationError";
  }
}

/** Handlingen er ikke tilladt. Beskeden vises til brugeren. */
export class PreorderActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreorderActionError";
  }
}

export const DATE_MODES = ["SHIPPING", "DELIVERY"] as const;
export type DateMode = (typeof DATE_MODES)[number];

export type SettingsInput = {
  dateMode: DateMode;
  buttonLabel: string;
  shippingDateText: string;
  deliveryDateText: string;
  preorderNote: string;
};

export type VariantPlanInput = {
  productId: string;
  variantId: string;
  inventoryItemId: string;
  locationId: string | null;
};

export type DeliveryView = {
  id: string;
  variantId: string;
  position: number;
  date: string;
  quantity: number;
  status: string;
  allocated: number;
  remaining: number;
  state: DeliveryState;
  allocationCount: number;
  /** Ordrer med tildelinger i leverancen (også annullerede tildelinger). */
  orders: { orderId: string; quantity: number; status: string }[];
};

export function forShop(shop: string, client: PrismaClient = db) {
  if (!shop) throw new Error("forShop kræver en butik.");

  async function findDelivery(tx: Tx, id: string) {
    const delivery = await tx.delivery.findFirst({ where: { id, shop } });
    if (!delivery) throw new PreorderActionError("Leverancen findes ikke.");
    return delivery;
  }

  async function activeAllocated(tx: Tx, deliveryId: string) {
    const allocations = await tx.allocation.findMany({
      where: { shop, deliveryId },
      select: { quantity: true, status: true },
    });
    return { allocations, allocated: allocatedQuantity(allocations) };
  }

  return {
    settings: {
      async get() {
        return client.shopSetting.upsert({
          where: { shop },
          create: { shop },
          update: {},
        });
      },

      async update(input: SettingsInput) {
        return client.shopSetting.upsert({
          where: { shop },
          create: { shop, ...input },
          update: input,
        });
      },
    },

    variantPlans: {
      /** Produkter med mindst én variant i appen, og hvor mange der er slået til. */
      async listProducts() {
        const plans = await client.variantPlan.findMany({
          where: { shop },
          select: { productId: true, preorderEnabled: true },
          orderBy: { createdAt: "asc" },
        });
        const products = new Map<
          string,
          { productId: string; variants: number; enabled: number }
        >();
        for (const plan of plans) {
          const entry = products.get(plan.productId) ?? {
            productId: plan.productId,
            variants: 0,
            enabled: 0,
          };
          entry.variants += 1;
          if (plan.preorderEnabled) entry.enabled += 1;
          products.set(plan.productId, entry);
        }
        return [...products.values()];
      },

      async listForProduct(productId: string) {
        return client.variantPlan.findMany({
          where: { shop, productId },
          orderBy: { createdAt: "asc" },
        });
      },

      /**
       * Tilføjer varianter. Findes en variant allerede, opdateres kun dens
       * lager-id'er — om forudbestilling er slået til, bevares.
       */
      async addVariants(variants: VariantPlanInput[]) {
        await client.$transaction(
          variants.map((variant) =>
            client.variantPlan.upsert({
              where: { shop_variantId: { shop, variantId: variant.variantId } },
              create: { shop, ...variant },
              update: {
                inventoryItemId: variant.inventoryItemId,
                locationId: variant.locationId,
              },
            }),
          ),
        );
      },

      async setEnabled(variantId: string, enabled: boolean) {
        const result = await client.variantPlan.updateMany({
          where: { shop, variantId },
          data: { preorderEnabled: enabled },
        });
        if (result.count === 0) {
          throw new PreorderActionError("Varianten findes ikke i appen.");
        }
      },
    },

    deliveries: {
      /** Leverancer for varianterne med udregnet resterende antal og status. */
      async listForVariants(variantIds: string[]): Promise<DeliveryView[]> {
        const rows = await client.delivery.findMany({
          where: { shop, variantId: { in: variantIds } },
          include: {
            allocations: {
              where: { shop },
              select: { orderId: true, quantity: true, status: true },
            },
          },
          orderBy: [{ variantId: "asc" }, { position: "asc" }],
        });

        const withRemaining = rows.map((row) => ({
          ...row,
          allocated: allocatedQuantity(row.allocations),
          remaining: remainingQuantity(row.quantity, row.allocations),
        }));

        const activeByVariant = new Map<string, string | null>();
        for (const variantId of variantIds) {
          const active = findActiveDelivery(
            withRemaining.filter((row) => row.variantId === variantId),
          );
          activeByVariant.set(variantId, active?.id ?? null);
        }

        return withRemaining.map((row) => ({
          id: row.id,
          variantId: row.variantId,
          position: row.position,
          date: row.date,
          quantity: row.quantity,
          status: row.status,
          allocated: row.allocated,
          remaining: row.remaining,
          state: deliveryState(row, activeByVariant.get(row.variantId) ?? null),
          allocationCount: row.allocations.length,
          orders: row.allocations,
        }));
      },

      /** Opretter en leverance bagerst i rækkefølgen for varianten. */
      async create(variantId: string, input: DeliveryInput, today: string) {
        const result = validateDelivery(input, { today, allocated: 0 });
        if (!result.ok) throw new DeliveryValidationError(result.errors);

        return client.$transaction(async (tx) => {
          const plan = await tx.variantPlan.findFirst({
            where: { shop, variantId },
          });
          if (!plan) {
            throw new PreorderActionError("Varianten findes ikke i appen.");
          }
          const last = await tx.delivery.aggregate({
            where: { shop, variantId },
            _max: { position: true },
          });
          return tx.delivery.create({
            data: {
              shop,
              variantId,
              position: (last._max.position ?? 0) + 1,
              ...result.value,
            },
          });
        });
      },

      async update(id: string, input: DeliveryInput, today: string) {
        return client.$transaction(async (tx) => {
          const delivery = await findDelivery(tx, id);
          if (delivery.status === "CANCELLED") {
            throw new PreorderActionError(
              "En annulleret leverance kan ikke rettes.",
            );
          }
          // Tildelt antal læses i samme transaktion som opdateringen.
          const { allocated } = await activeAllocated(tx, id);
          const result = validateDelivery(input, {
            today,
            allocated,
            currentDate: delivery.date,
          });
          if (!result.ok) throw new DeliveryValidationError(result.errors);

          await tx.delivery.updateMany({
            where: { id, shop },
            data: result.value,
          });
        });
      },

      /** Sletter kun leverancer, der aldrig har haft tildelinger. */
      async remove(id: string) {
        return client.$transaction(async (tx) => {
          await findDelivery(tx, id);
          const allocations = await tx.allocation.count({
            where: { shop, deliveryId: id },
          });
          if (allocations > 0) {
            throw new PreorderActionError(
              "Leverancen har tildelte ordrer og kan ikke slettes. Annullér den i stedet — så kan du se, hvilke ordrer der er berørt.",
            );
          }
          await tx.delivery.deleteMany({ where: { id, shop } });
        });
      },

      /**
       * Annullerer en leverance. Tildelingerne bliver liggende, så det kan
       * ses, hvilke ordrer der er berørt.
       */
      async cancel(id: string) {
        return client.$transaction(async (tx) => {
          const delivery = await findDelivery(tx, id);
          if (delivery.status === "CANCELLED") return;
          await tx.delivery.updateMany({
            where: { id, shop },
            data: { status: "CANCELLED", cancelledAt: new Date() },
          });
        });
      },
    },
  };
}

type Tx = Prisma.TransactionClient;
