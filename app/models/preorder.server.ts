import type { Prisma, PrismaClient } from "@prisma/client";
import db from "../db.server";
import {
  planLineAllocation,
  sameAllocation,
  type Bucket,
} from "../lib/allocation";
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

/** En ordre, som Shopify ser den nu. Læses frisk ved hver behandling. */
export type OrderSnapshot = {
  id: string;
  name: string;
  createdAt: string;
  cancelled: boolean;
  lines: {
    id: string;
    variantId: string | null;
    sellingPlanId: string | null;
    /** Nuværende antal efter rettelser og refunderinger. */
    quantity: number;
  }[];
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
  /** Selling plan i Shopify. Tom, indtil leverancen er synkroniseret. */
  sellingPlanId: string | null;
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
        // Tidspunktet sættes kun, når forudbestilling går fra slået fra til
        // slået til — ikke hvis den allerede var slået til.
        if (enabled) {
          await client.variantPlan.updateMany({
            where: { shop, variantId, preorderEnabled: false },
            data: { preorderEnabledAt: new Date() },
          });
        }
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
          sellingPlanId: row.sellingPlanId,
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
          return { variantId: delivery.variantId };
        });
      },

      /** Sletter kun leverancer, der aldrig har haft tildelinger. */
      async remove(id: string) {
        return client.$transaction(async (tx) => {
          const delivery = await findDelivery(tx, id);
          const allocations = await tx.allocation.count({
            where: { shop, deliveryId: id },
          });
          if (allocations > 0) {
            throw new PreorderActionError(
              "Leverancen har tildelte ordrer og kan ikke slettes. Annullér den i stedet — så kan du se, hvilke ordrer der er berørt.",
            );
          }
          await tx.delivery.deleteMany({ where: { id, shop } });
          return { variantId: delivery.variantId };
        });
      },

      /**
       * Annullerer en leverance. Tildelingerne bliver liggende, så det kan
       * ses, hvilke ordrer der er berørt.
       */
      async cancel(id: string) {
        return client.$transaction(async (tx) => {
          const delivery = await findDelivery(tx, id);
          if (delivery.status !== "CANCELLED") {
            await tx.delivery.updateMany({
              where: { id, shop },
              data: { status: "CANCELLED", cancelledAt: new Date() },
            });
          }
          return { variantId: delivery.variantId };
        });
      },
    },

    // Kun til brug for app/sync/. Holder styr på, hvad der er sendt til
    // Shopify, og hvordan seneste synkronisering gik.
    syncState: {
      async getVariant(variantId: string) {
        return client.variantPlan.findFirst({ where: { shop, variantId } });
      },

      async setGroupId(variantId: string, sellingPlanGroupId: string | null) {
        await client.variantPlan.updateMany({
          where: { shop, variantId },
          data: { sellingPlanGroupId },
        });
      },

      async markRequiresSellingPlan(productId: string, value: boolean) {
        await client.variantPlan.updateMany({
          where: { shop, productId },
          data: { setRequiresSellingPlan: value },
        });
      },

      /** Husker, hvilken leverance en plan hører til. Slettes aldrig. */
      async recordPlanRef(sellingPlanId: string, deliveryId: string) {
        await client.sellingPlanRef.upsert({
          where: { shop_sellingPlanId: { shop, sellingPlanId } },
          create: { shop, sellingPlanId, deliveryId },
          update: {},
        });
      },

      async setDeliveryPlanId(
        deliveryId: string,
        sellingPlanId: string | null,
      ) {
        await client.delivery.updateMany({
          where: { shop, id: deliveryId },
          data: { sellingPlanId },
        });
      },

      async recordSuccess(variantId: string, available: number | null) {
        const now = new Date();
        await client.variantPlan.updateMany({
          where: { shop, variantId },
          data: {
            lastSyncedAt: now,
            lastSyncAttemptAt: now,
            lastSyncError: null,
            syncedAvailable: available,
          },
        });
      },

      async recordFailure(variantId: string, message: string) {
        await client.variantPlan.updateMany({
          where: { shop, variantId },
          data: { lastSyncAttemptAt: new Date(), lastSyncError: message },
        });
      },
    },
    orders: {
      /**
       * Bringer en ordres tildelinger i overensstemmelse med ordren, som den
       * ser ud i Shopify nu. Idempotent: samme ordre to gange ændrer intet.
       * Tildelinger slettes aldrig — en ændring annullerer den gamle række og
       * opretter en ny.
       *
       * Returnerer de varianter, der er berørt, så deres lager kan
       * synkroniseres.
       */
      async apply(order: OrderSnapshot) {
        return client.$transaction(async (tx) => {
          const variantIds = new Set<string>();
          let changed = false;
          const handledLines = new Set<string>();

          for (const line of order.lines) {
            const target = await lineTarget(tx, order, line);
            if (!target) continue; // Ikke en forudbestilling.
            handledLines.add(line.id);
            variantIds.add(target.variantId);

            const lineChanged = await applyLine(tx, order, line.id, {
              ...target,
              desired: order.cancelled ? 0 : line.quantity,
            });
            changed ||= lineChanged;
          }

          // Linjer, der ikke længere findes på ordren, frigives.
          const orphans = await tx.allocation.findMany({
            where: {
              shop,
              orderId: order.id,
              status: { in: ["ACTIVE", "UNRESOLVED"] },
              orderLineId: { notIn: [...handledLines] },
            },
          });
          for (const row of orphans) {
            await cancelRow(tx, row.id);
            variantIds.add(row.variantId);
            changed = true;
          }

          return { variantIds: [...variantIds], changed };
        });
      },

      /** Alle ordrens tildelinger, til ordrens metafelt og tags. */
      async allocationsForOrder(orderId: string) {
        return client.allocation.findMany({
          where: { shop, orderId },
          include: { delivery: { select: { position: true } } },
          orderBy: [{ orderLineId: "asc" }, { allocatedAt: "asc" }],
        });
      },

      async forDelivery(deliveryId: string) {
        const delivery = await client.delivery.findFirst({
          where: { shop, id: deliveryId },
        });
        if (!delivery) return null;
        const allocations = await client.allocation.findMany({
          where: { shop, deliveryId },
          orderBy: [{ orderCreatedAt: "asc" }, { allocatedAt: "asc" }],
        });
        return { delivery, allocations };
      },

      /** Ordrelinjer talt med af sikkerhedsnettet (købt uden plan). */
      async withoutPlan(limit = 100) {
        return client.allocation.findMany({
          where: { shop, soldWithoutPlan: true },
          orderBy: [{ orderCreatedAt: "desc" }, { allocatedAt: "desc" }],
          take: limit,
        });
      },

      /** Antal ordrer købt uden plan siden et tidspunkt. */
      async countWithoutPlanSince(since: Date) {
        const rows = await client.allocation.findMany({
          where: { shop, soldWithoutPlan: true, orderCreatedAt: { gte: since } },
          distinct: ["orderId"],
          select: { orderId: true },
        });
        return rows.length;
      },

      async unresolved() {
        return client.allocation.findMany({
          where: { shop, status: "UNRESOLVED" },
          orderBy: { orderCreatedAt: "asc" },
        });
      },
    },
  };

  async function deliveryForPlan(tx: Tx, sellingPlanId: string) {
    const ref = await tx.sellingPlanRef.findUnique({
      where: { shop_sellingPlanId: { shop, sellingPlanId } },
    });
    const deliveryId =
      ref?.deliveryId ??
      (await tx.delivery.findFirst({ where: { shop, sellingPlanId } }))?.id;
    if (!deliveryId) return null;
    return tx.delivery.findFirst({ where: { shop, id: deliveryId } });
  }

  async function cancelRow(tx: Tx, id: string) {
    await tx.allocation.updateMany({
      where: { shop, id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
  }

  /**
   * Hvilken variant og leverance en ordrelinje hører til — eller null, hvis
   * linjen ikke er en forudbestilling.
   *
   * 1. Linjen har en af appens selling plans: planens leverance.
   * 2. SIKKERHEDSNETTET: linjen har ingen af appens planer, men varianten har
   *    forudbestilling slået til (og havde det, da ordren blev oprettet). Så
   *    er enheden alligevel trukket fra Shopifys lager og skal tælles — ellers
   *    skriver næste synkronisering lageret op igen, og varen sælges én gang
   *    for meget. Linjen lægges i den aktive leverance og mærkes "uden plan".
   *    Det gælder uanset hvordan ordren er opstået: webshop, kladdeordre, POS
   *    eller API.
   * 3. Har linjen allerede tildelinger uden plan, behandles den videre som
   *    sådan, også hvis forudbestilling siden er slået fra.
   */
  async function lineTarget(
    tx: Tx,
    order: OrderSnapshot,
    line: OrderSnapshot["lines"][number],
  ): Promise<{
    variantId: string;
    startDeliveryId: string | null;
    soldWithoutPlan: boolean;
  } | null> {
    if (line.sellingPlanId) {
      const start = await deliveryForPlan(tx, line.sellingPlanId);
      if (start) {
        return {
          variantId: start.variantId,
          startDeliveryId: start.id,
          soldWithoutPlan: false,
        };
      }
    }
    if (!line.variantId) return null;

    const plan = await tx.variantPlan.findFirst({
      where: { shop, variantId: line.variantId },
    });
    const enabledWhenOrdered =
      plan?.preorderEnabled === true &&
      plan.preorderEnabledAt != null &&
      plan.preorderEnabledAt <= new Date(order.createdAt);
    const alreadyCounted =
      (await tx.allocation.count({
        where: { shop, orderLineId: line.id, soldWithoutPlan: true },
      })) > 0;
    if (!enabledWhenOrdered && !alreadyCounted) return null;

    // Den aktive leverance: den første åbne. Er den udsolgt, fylder
    // fordelingen videre i de næste — præcis som for en linje med plan.
    const first = await tx.delivery.findFirst({
      where: { shop, variantId: line.variantId, status: "OPEN" },
      orderBy: { position: "asc" },
    });
    return {
      variantId: line.variantId,
      startDeliveryId: first?.id ?? null,
      soldWithoutPlan: true,
    };
  }

  async function applyLine(
    tx: Tx,
    order: OrderSnapshot,
    orderLineId: string,
    {
      variantId,
      startDeliveryId,
      soldWithoutPlan,
      desired,
    }: {
      variantId: string;
      /** Null: ingen åben leverance — alt bliver uafklaret. */
      startDeliveryId: string | null;
      soldWithoutPlan: boolean;
      desired: number;
    },
  ) {
    const rows = await tx.allocation.findMany({
      where: { shop, orderLineId, status: { in: ["ACTIVE", "UNRESOLVED"] } },
    });
    const keyOf = (row: { status: string; deliveryId: string | null }) =>
      row.status === "UNRESOLVED" ? null : row.deliveryId;
    const current: Bucket[] = rows.map((row) => ({
      deliveryId: keyOf(row),
      quantity: row.quantity,
      promisedDate: row.promisedDate,
    }));

    const deliveries = await tx.delivery.findMany({
      where: { shop, variantId },
      include: {
        allocations: {
          where: { shop, status: "ACTIVE" },
          select: { quantity: true, status: true },
        },
      },
    });
    const target = planLineAllocation({
      desired,
      current,
      startDeliveryId,
      deliveries: deliveries.map((d) => ({
        id: d.id,
        position: d.position,
        date: d.date,
        status: d.status,
        remaining: remainingQuantity(d.quantity, d.allocations),
      })),
    });
    if (sameAllocation(target, current)) return false;

    // Rækker, hvis antal ikke passer, annulleres; nye oprettes. Ingen rækker
    // slettes, og ingen rækkers antal ændres.
    for (const row of rows) {
      const wanted = target.find((b) => b.deliveryId === keyOf(row));
      if (wanted?.quantity !== row.quantity) await cancelRow(tx, row.id);
    }
    for (const bucket of target) {
      const existing = rows.find((row) => keyOf(row) === bucket.deliveryId);
      if (existing?.quantity === bucket.quantity) continue;
      await tx.allocation.create({
        data: {
          shop,
          orderId: order.id,
          orderName: order.name,
          orderCreatedAt: new Date(order.createdAt),
          orderLineId,
          variantId,
          deliveryId: bucket.deliveryId,
          quantity: bucket.quantity,
          status: bucket.deliveryId ? "ACTIVE" : "UNRESOLVED",
          promisedDate: bucket.promisedDate,
          soldWithoutPlan,
        },
      });
    }
    return true;
  }
}

type Tx = Prisma.TransactionClient;
