import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import db from "../db.server";
import type { EventType } from "../events/build";
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
    /** Antal, der endnu ikke er sendt. Kun når Shopify har oplyst det. */
    unfulfilled?: number;
    /** Produkt og variant, til kundens annulleringsside. */
    title?: string;
    variantTitle?: string | null;
  }[];
  /**
   * Betaling. paid: ordren er betalt fuldt ud. failedAt: seneste afviste
   * betalingsforsøg (opkrævning ved afsendelse), eller null.
   */
  payment?: { paid: boolean; failedAt: string | null };
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

    dashboard: {
      /** Det, forsiden viser: varianter, ordrer de seneste 60 dage og ventende stk. */
      async overview(now = new Date()) {
        const since60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
        const [plans, recent, waiting, ready] = await Promise.all([
          client.variantPlan.findMany({
            where: { shop },
            select: {
              variantId: true,
              productId: true,
              preorderEnabled: true,
              mode: true,
            },
          }),
          client.allocation.findMany({
            where: {
              shop,
              status: { in: ["ACTIVE", "UNRESOLVED"] },
              orderCreatedAt: { gte: since60 },
            },
            select: { orderId: true, quantity: true, orderCreatedAt: true },
          }),
          client.allocation.aggregate({
            where: {
              shop,
              status: "ACTIVE",
              readyAt: null,
              delivery: { status: "OPEN" },
            },
            _sum: { quantity: true },
          }),
          client.allocation.aggregate({
            where: { shop, status: "ACTIVE", readyAt: { not: null } },
            _sum: { quantity: true },
          }),
        ]);
        return {
          plans,
          recent,
          waitingUnits: waiting._sum.quantity ?? 0,
          readyUnits: ready._sum.quantity ?? 0,
        };
      },
    },

    variantPlans: {
      /** Produkter med mindst én variant i appen, og hvor mange der er slået til. */
      async listProducts() {
        const plans = await client.variantPlan.findMany({
          where: { shop },
          select: { productId: true, preorderEnabled: true, mode: true },
          orderBy: { createdAt: "asc" },
        });
        const products = new Map<
          string,
          {
            productId: string;
            variants: number;
            enabled: number;
            inPreorder: number;
          }
        >();
        for (const plan of plans) {
          const entry = products.get(plan.productId) ?? {
            productId: plan.productId,
            variants: 0,
            enabled: 0,
            inPreorder: 0,
          };
          entry.variants += 1;
          if (plan.preorderEnabled) entry.enabled += 1;
          if (plan.preorderEnabled && plan.mode === "PREORDER") {
            entry.inPreorder += 1;
          }
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

      /** Tving (eller slip) forudbestilling, selvom der er lager. */
      async setForced(variantId: string, forced: boolean) {
        const result = await client.variantPlan.updateMany({
          where: { shop, variantId },
          data: { modeForced: forced },
        });
        if (result.count === 0) {
          throw new PreorderActionError("Varianten findes ikke i appen.");
        }
      },

      async findByInventoryItem(inventoryItemId: string) {
        return client.variantPlan.findFirst({
          where: { shop, inventoryItemId },
        });
      },

      /** Seneste tilstandsskift for en variant, nyeste først. */
      async modeHistory(variantId: string, take = 10) {
        return client.modeChange.findMany({
          where: { shop, variantId },
          orderBy: { at: "desc" },
          take,
        });
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

          // Linjernes forventede dato før ændringen (til «forsinket»).
          const before =
            result.value.date > delivery.date
              ? await lineDates(tx, { deliveryId: id })
              : new Map<string, LineDate>();

          await tx.delivery.updateMany({
            where: { id, shop },
            data: result.value,
          });

          // Datoen er rykket senere: hver berørt forudbestilling, der ikke
          // allerede er klar, får en «forsinket»-hændelse.
          if (before.size > 0) {
            const after = await lineDates(tx, { deliveryId: id });
            for (const [lineId, line] of after) {
              const previous = before.get(lineId);
              if (!previous || line.allReady) continue;
              if (line.date > previous.date) {
                await recordEvent(tx, line, "preorder.delayed", {
                  dedupeKey: `delayed:${lineId}:${line.date}`,
                  deliveryDate: line.date,
                  previousDate: previous.date,
                });
              }
            }
          }
          return { variantId: delivery.variantId };
        });
      },

      /**
       * Markerer alle forudbestillinger i leverancen som klar til afsendelse
       * (varerne er kommet hjem). Giver «klar til afsendelse»-hændelser.
       */
      async markReady(id: string) {
        return client.$transaction(async (tx) => {
          const delivery = await findDelivery(tx, id);
          const rows = await tx.allocation.findMany({
            where: { shop, deliveryId: id, status: "ACTIVE", readyAt: null },
            select: { id: true, orderLineId: true },
          });
          await tx.allocation.updateMany({
            where: { shop, id: { in: rows.map((r) => r.id) } },
            data: { readyAt: new Date() },
          });
          await emitReady(
            tx,
            rows.map((r) => r.orderLineId),
          );
          return { variantId: delivery.variantId, count: rows.length };
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

      /** Gemmer et tilstandsskift på varianten og i historikken. */
      async recordModeChange(
        variantId: string,
        mode: "STOCK" | "PREORDER",
        reason: string,
        forced: boolean,
      ) {
        const at = new Date();
        await client.variantPlan.updateMany({
          where: { shop, variantId },
          data: { mode, modeChangedAt: at, modeChangeReason: reason },
        });
        await client.modeChange.create({
          data: { shop, variantId, mode, reason, forced, at },
        });
      },

      /** Sætter (eller rydder) lageret fra før tvangen og varer modtaget imens. */
      async setStockBeforeForce(variantId: string, value: number | null) {
        await client.variantPlan.updateMany({
          where: { shop, variantId },
          data: { stockBeforeForce: value, receivedWhileForced: 0 },
        });
      },

      /**
       * Forudbestilte stk., der stadig venter på varer: aktive tildelinger i
       * åbne leverancer, som ikke er markeret klar til afsendelse.
       */
      async owedUnits(variantId: string) {
        const rows = await client.allocation.aggregate({
          where: {
            shop,
            variantId,
            status: "ACTIVE",
            readyAt: null,
            delivery: { status: "OPEN" },
          },
          _sum: { quantity: true },
        });
        return rows._sum.quantity ?? 0;
      },

      /** Alle forudbestillinger er dækket af varer (skift til lagermode). */
      async markAllReady(variantId: string) {
        await client.$transaction(async (tx) => {
          const rows = await tx.allocation.findMany({
            where: {
              shop,
              variantId,
              status: "ACTIVE",
              readyAt: null,
              delivery: { status: "OPEN" },
            },
            select: { id: true, orderLineId: true },
          });
          await tx.allocation.updateMany({
            where: { shop, id: { in: rows.map((r) => r.id) } },
            data: { readyAt: new Date() },
          });
          await emitReady(
            tx,
            rows.map((r) => r.orderLineId),
          );
        });
      },

      async addReceivedWhileForced(variantId: string, quantity: number) {
        await client.variantPlan.updateMany({
          where: { shop, variantId },
          data: { receivedWhileForced: { increment: quantity } },
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
          const orphanLines = await lineDates(tx, {
            lineIds: [...new Set(orphans.map((r) => r.orderLineId))],
          });
          for (const row of orphans) {
            await cancelRow(tx, row.id);
            variantIds.add(row.variantId);
            changed = true;
          }
          for (const [lineId, line] of orphanLines) {
            await recordEvent(tx, line, "preorder.cancelled", {
              dedupeKey: `cancelled:${lineId}`,
              deliveryDate: line.date,
            });
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
          where: {
            shop,
            soldWithoutPlan: true,
            orderCreatedAt: { gte: since },
          },
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
    const orderedAt = new Date(order.createdAt);
    // Kun salg i forudbestillingsmode tælles. Et almindeligt salg i
    // lagermode er webshopejerens eget lager og skal ikke tildeles.
    const modeWhenOrdered = await tx.modeChange.findFirst({
      where: { shop, variantId: line.variantId, at: { lte: orderedAt } },
      orderBy: { at: "desc" },
    });
    const enabledWhenOrdered =
      plan?.preorderEnabled === true &&
      plan.preorderEnabledAt != null &&
      plan.preorderEnabledAt <= orderedAt &&
      modeWhenOrdered?.mode === "PREORDER";
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

    const activeBefore = rows.filter((r) => r.status === "ACTIVE");
    const activeAfter = target.filter((b) => b.deliveryId != null);
    const sum = (xs: { quantity: number }[]) =>
      xs.reduce((n, x) => n + x.quantity, 0);
    const latest = (dates: (string | null)[]) =>
      dates
        .filter((d): d is string => d != null)
        .sort()
        .pop() ?? null;
    const event = {
      orderId: order.id,
      orderName: order.name,
      orderLineId,
      variantId,
    };
    if (activeBefore.length === 0 && activeAfter.length > 0) {
      // Første gang linjen får plads i en leverance.
      await recordEvent(
        tx,
        { ...event, quantity: sum(activeAfter) },
        "preorder.created",
        {
          dedupeKey: `created:${orderLineId}`,
          deliveryDate: latest(activeAfter.map((b) => b.promisedDate)),
        },
      );
    } else if (activeBefore.length > 0 && desired === 0) {
      await recordEvent(
        tx,
        { ...event, quantity: sum(activeBefore) },
        "preorder.cancelled",
        {
          dedupeKey: `cancelled:${orderLineId}`,
          deliveryDate: latest(activeBefore.map((r) => r.promisedDate)),
        },
      );
    }

    // Rækker, hvis antal ikke passer, annulleres; nye oprettes. Ingen rækker
    // slettes, og ingen rækkers antal ændres.
    for (const row of rows) {
      const wanted = target.find((b) => b.deliveryId === keyOf(row));
      if (wanted?.quantity !== row.quantity) await cancelRow(tx, row.id);
    }
    for (const bucket of target) {
      const existing = rows.find((row) => keyOf(row) === bucket.deliveryId);
      if (existing?.quantity === bucket.quantity) continue;
      // Var varerne allerede kommet hjem til en større række i samme
      // leverance, er den mindre række også klar.
      const readyAt =
        existing?.readyAt && existing.quantity >= bucket.quantity
          ? existing.readyAt
          : null;
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
          readyAt,
        },
      });
    }
    return true;
  }

  type LineDate = {
    orderId: string;
    orderName: string;
    orderLineId: string;
    variantId: string;
    quantity: number;
    /** Den seneste leverancedato for linjens aktive tildelinger. */
    date: string;
    allReady: boolean;
  };

  /** Linjers aktive tildelinger, samlet pr. linje, med leverancens dato nu. */
  async function lineDates(
    tx: Tx,
    by: { deliveryId?: string; lineIds?: string[] },
  ): Promise<Map<string, LineDate>> {
    const lineIds =
      by.lineIds ??
      (
        await tx.allocation.findMany({
          where: { shop, deliveryId: by.deliveryId, status: "ACTIVE" },
          select: { orderLineId: true },
          distinct: ["orderLineId"],
        })
      ).map((r) => r.orderLineId);
    if (lineIds.length === 0) return new Map();
    const rows = await tx.allocation.findMany({
      where: { shop, orderLineId: { in: lineIds }, status: "ACTIVE" },
      include: { delivery: { select: { date: true } } },
    });
    const lines = new Map<string, LineDate>();
    for (const row of rows) {
      const date = row.delivery?.date ?? row.promisedDate ?? "";
      const line = lines.get(row.orderLineId) ?? {
        orderId: row.orderId,
        orderName: row.orderName,
        orderLineId: row.orderLineId,
        variantId: row.variantId,
        quantity: 0,
        date,
        allReady: true,
      };
      line.quantity += row.quantity;
      if (date > line.date) line.date = date;
      line.allReady &&= row.readyAt != null;
      lines.set(row.orderLineId, line);
    }
    return lines;
  }

  /** «Klar til afsendelse» for linjer, hvor alle aktive tildelinger er klar. */
  async function emitReady(tx: Tx, lineIds: string[]) {
    const lines = await lineDates(tx, { lineIds: [...new Set(lineIds)] });
    for (const [lineId, line] of lines) {
      if (!line.allReady) continue;
      await recordEvent(tx, line, "preorder.ready", {
        dedupeKey: `ready:${lineId}`,
        deliveryDate: line.date,
      });
    }
  }

  /**
   * Lægger en hændelse i udbakken i samme transaktion som ændringen.
   * dedupeKey gør det idempotent: samme ændring giver kun én hændelse.
   * Hændelsen bygges og sendes bagefter af app/events/outbox.server.ts.
   */
  async function recordEvent(
    tx: Tx,
    line: {
      orderId: string;
      orderName: string;
      orderLineId: string;
      variantId: string;
      quantity: number;
    },
    type: EventType,
    extra: {
      dedupeKey: string;
      deliveryDate: string | null;
      previousDate?: string | null;
    },
  ) {
    await tx.outboxEvent.createMany({
      data: [
        {
          id: randomUUID(),
          shop,
          type,
          dedupeKey: extra.dedupeKey,
          orderId: line.orderId,
          orderName: line.orderName,
          orderLineId: line.orderLineId,
          variantId: line.variantId,
          quantity: line.quantity,
          deliveryDate: extra.deliveryDate,
          previousDate: extra.previousDate ?? null,
        },
      ],
      skipDuplicates: true,
    });
  }
}

type Tx = Prisma.TransactionClient;
