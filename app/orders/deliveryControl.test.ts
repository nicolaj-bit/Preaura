import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { forShop, type OrderSnapshot } from "../models/preorder.server";
import { enqueueWebhook } from "../lib/webhookQueue.server";
import { createTestDb } from "../test/testDb";
import { createFakeShopify } from "../test/fakeShopify";
import { syncVariant } from "../sync/syncVariant.server";
import { syncOrder } from "../sync/syncOrder.server";
import { processShopQueue } from "./processQueue.server";

// Opgave 16: automatiske tests af leverancestyringen.
//
// Alt kører hele vejen: webhook i kø → ordrekøen → tildelinger → lager,
// selling plans og ordrefelter i en simuleret Shopify. Databasen er en rigtig
// PostgreSQL med appens migrationer (egen database, aldrig produktion eller
// en butik med rigtige kunder).

const testDb = createTestDb();
const client = testDb.client;
const SHOP = "levering.myshopify.com";
const TODAY = "2026-11-02";
const JAN_1 = "2027-01-01";
const JAN_15 = "2027-01-15";
const V1 = "gid://shopify/ProductVariant/1";
const V2 = "gid://shopify/ProductVariant/2";

beforeAll(() => testDb.setup());
afterAll(() => testDb.teardown());
beforeEach(() => testDb.reset());

const data = () => forShop(SHOP, client);

type VariantSetup = {
  variantId: string;
  deliveries: { date: string; quantity: number }[];
};

/** Varianter med leverancer, synkroniseret, så hver leverance har sin plan. */
async function setup(variants: VariantSetup[]) {
  const shopify = createFakeShopify();
  const ids = new Map<string, string[]>();
  for (const [i, v] of variants.entries()) {
    const item = `gid://shopify/InventoryItem/${i + 1}`;
    await data().variantPlans.addVariants([
      {
        productId: "gid://shopify/Product/1",
        variantId: v.variantId,
        inventoryItemId: item,
        locationId: "gid://shopify/Location/1",
      },
    ]);
    await data().variantPlans.setEnabled(v.variantId, true);
    const list: string[] = [];
    for (const d of v.deliveries) {
      const created = await data().deliveries.create(
        v.variantId,
        { date: d.date, quantity: String(d.quantity) },
        TODAY,
      );
      list.push(created.id);
    }
    ids.set(v.variantId, list);
    shopify.addVariant(v.variantId, { inventoryItemId: item, available: 0 });
  }
  const sync = (variantId: string) =>
    syncVariant({ shop: SHOP, variantId, gateway: shopify.gateway, client });
  for (const v of variants) expect((await sync(v.variantId)).ok).toBe(true);

  const planOf = async (deliveryId: string) =>
    (await client.delivery.findUniqueOrThrow({ where: { id: deliveryId } }))
      .sellingPlanId!;
  const delivery = (variantId: string, n: number) => ids.get(variantId)![n];

  let seq = 0;
  /** Gør det muligt at holde en behandling fast midt i en ordre. */
  let readGate: (() => Promise<void>) | null = null;

  const deps = {
    readOrder: async (id: string) => {
      if (readGate) await readGate();
      return (await shopify.gateway.readOrder(id))?.snapshot ?? null;
    },
    syncVariant: sync,
    syncOrder: (orderId: string) =>
      syncOrder({ shop: SHOP, orderId, gateway: shopify.gateway, client }),
  };

  return {
    shopify,
    delivery,
    planOf,
    sync,
    setReadGate(gate: (() => Promise<void>) | null) {
      readGate = gate;
    },
    /** Lægger en ordre i Shopify og sender ordrens webhook. */
    async order(
      n: number,
      lines: { variantId?: string; quantity: number; deliveryId?: string }[],
      opts: { topic?: string; cancelled?: boolean; createdAt?: string } = {},
    ) {
      const snapshot: OrderSnapshot = {
        id: `gid://shopify/Order/${n}`,
        name: `#${1000 + n}`,
        // Bestillingstidspunktet afgør rækkefølgen: ordre n er bestilt før n+1.
        createdAt:
          opts.createdAt ??
          new Date(Date.UTC(2026, 10, 2, 10, 0, 0, n)).toISOString(),
        cancelled: opts.cancelled ?? false,
        lines: await Promise.all(
          lines.map(async (line, i) => ({
            id: `gid://shopify/LineItem/${n}-${i}`,
            variantId: line.variantId ?? V1,
            sellingPlanId: line.deliveryId
              ? await planOf(line.deliveryId)
              : null,
            quantity: line.quantity,
          })),
        ),
      };
      shopify.putOrder(snapshot);
      await enqueueWebhook(
        {
          webhookId: `wh-${++seq}`,
          shop: SHOP,
          topic: opts.topic ?? "ORDERS_CREATE",
          payload: {
            admin_graphql_api_id: snapshot.id,
            created_at: snapshot.createdAt,
          },
        },
        client,
      );
      return snapshot;
    },
    /** En lagerændring i Shopify, som appen får besked om via webhook. */
    async inventoryChange(itemNo: number, available: number) {
      await enqueueWebhook(
        {
          webhookId: `inv-${++seq}`,
          shop: SHOP,
          topic: "INVENTORY_LEVELS_UPDATE",
          payload: { inventory_item_id: itemNo, location_id: 1, available },
        },
        client,
      );
    },
    run: () => processShopQueue({ shop: SHOP, client, deps }),
    /** Ordrens levende tildelinger (aktive og uafklarede). */
    async live(orderNo: number) {
      return client.allocation.findMany({
        where: {
          shop: SHOP,
          orderId: `gid://shopify/Order/${orderNo}`,
          status: { in: ["ACTIVE", "UNRESOLVED"] },
        },
        orderBy: { allocatedAt: "asc" },
      });
    },
    async remaining(variantId = V1) {
      const views = await data().deliveries.listForVariants([variantId]);
      return views
        .sort((a, b) => a.position - b.position)
        .map((v) => v.remaining);
    },
    available: (variantId = V1) => shopify.variants.get(variantId)!.available,
    metafield: (variantId = V1) =>
      JSON.parse(
        shopify.variants.get(variantId)!.preorderMetafield ?? "null",
      ) as {
        date: string | null;
        sellingPlanId: string | null;
        remaining: number;
        soldOut: boolean;
      },
  };
}

// --- Punkt 4 -----------------------------------------------------------------

describe("to køb af den sidste enhed på samme tid", () => {
  it("køens lås: den anden behandler afvises, mens den første er i gang, og kun én får enheden", async () => {
    const h = await setup([
      { variantId: V1, deliveries: [{ date: JAN_1, quantity: 1 }] },
    ]);
    const d1 = h.delivery(V1, 0);
    // Begge kunder har købt den sidste enhed. Begge webhooks er modtaget.
    await h.order(1, [{ quantity: 1, deliveryId: d1 }]);
    await h.order(2, [{ quantity: 1, deliveryId: d1 }]);

    // Behandler A holdes fast midt i den første ordre (efter at have taget
    // låsen), mens behandler B starter. Det er den situation, låsen findes
    // for: to webhook-kald, der hver vil behandle køen.
    let entered!: () => void;
    const inside = new Promise<void>((r) => (entered = r));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.setReadGate(async () => {
      entered();
      await gate;
    });
    const runA = h.run();
    await inside;
    h.setReadGate(null);

    const runB = await h.run();
    expect(runB).toEqual({ ran: false });

    release();
    expect(await runA).toMatchObject({ ran: true, done: 2, failed: 0 });

    const [first] = await h.live(1);
    const [second] = await h.live(2);
    expect(first).toMatchObject({ status: "ACTIVE", deliveryId: d1 });
    expect(second).toMatchObject({ status: "UNRESOLVED", deliveryId: null });
    expect(await h.remaining()).toEqual([0]);
    expect(h.available()).toBe(0);
  });

  it("databasen: to samtidige afstemninger af den sidste enhed giver aldrig minus", async () => {
    // Låsen ovenfor er det første værn. Udløber den midt i en behandling
    // (fx et Shopify-kald, der hænger i mere end to minutter), kan to
    // behandlere køre samtidig. Så skal afstemningen selv holde: her kører
    // orders.apply for to forskellige ordrer i to samtidige transaktioner,
    // og begge holdes tilbage lige før de opretter deres tildeling, så de
    // ville have læst «1 tilbage» på samme tid.
    const h = await setup([
      { variantId: V1, deliveries: [{ date: JAN_1, quantity: 1 }] },
    ]);
    const d1 = h.delivery(V1, 0);
    const a = await h.order(1, [{ quantity: 1, deliveryId: d1 }]);
    const b = await h.order(2, [{ quantity: 1, deliveryId: d1 }]);

    let arrived = 0;
    let bothArrived!: () => void;
    const together = new Promise<void>((r) => (bothArrived = r));
    const held = client.$extends({
      query: {
        allocation: {
          async create({ args, query }) {
            arrived += 1;
            if (arrived === 2) bothArrived();
            // Venter på den anden transaktion, men højst 1,5 sek.: holder
            // databasen den anden tilbage (som den skal), kommer den aldrig.
            await Promise.race([
              together,
              new Promise((r) => setTimeout(r, 1500)),
            ]);
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;

    const results = await Promise.allSettled([
      forShop(SHOP, held).orders.apply(a),
      forShop(SHOP, held).orders.apply(b),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

    const active = await client.allocation.findMany({
      where: { shop: SHOP, status: "ACTIVE" },
    });
    const unresolved = await client.allocation.findMany({
      where: { shop: SHOP, status: "UNRESOLVED" },
    });
    expect(active).toHaveLength(1);
    expect(unresolved).toHaveLength(1);
    expect(await h.remaining()).toEqual([0]);
  });
});

// --- Punkt 3 -----------------------------------------------------------------

describe("grundscenariet: 150 + 150", () => {
  it(
    "ordre 1–150 i leverance 1, ordre 151 i leverance 2 med dens dato, og efter 300 lukker forudbestillingen",
    { timeout: 180_000 },
    async () => {
      const h = await setup([
        {
          variantId: V1,
          deliveries: [
            { date: JAN_1, quantity: 150 },
            { date: JAN_15, quantity: 150 },
          ],
        },
      ]);
      const [d1, d2] = [h.delivery(V1, 0), h.delivery(V1, 1)];
      const plan1 = await h.planOf(d1);
      const plan2 = await h.planOf(d2);

      // Alle 300 kunder køber på leverance 1's plan, som kunden ser den på
      // produktsiden, indtil appen skifter. Det er appen, der flytter ordre
      // 151 og frem til leverance 2.
      for (let n = 1; n <= 300; n++) {
        await h.order(n, [{ quantity: 1, deliveryId: d1 }]);
        if (n === 150) {
          expect(await h.run()).toMatchObject({ done: 150, failed: 0 });
          // Leverance 1 er fuld: produktsiden og lageret skifter selv.
          expect(await h.remaining()).toEqual([0, 150]);
          expect(h.metafield()).toMatchObject({
            date: JAN_15,
            sellingPlanId: plan2,
            remaining: 150,
            soldOut: false,
          });
          expect(h.available()).toBe(150);
        }
      }
      expect(await h.run()).toMatchObject({ done: 150, failed: 0 });

      const all = await client.allocation.findMany({
        where: { shop: SHOP, status: "ACTIVE" },
      });
      expect(all).toHaveLength(300);
      const byOrder = new Map(all.map((a) => [a.orderId, a]));
      for (let n = 1; n <= 300; n++) {
        const a = byOrder.get(`gid://shopify/Order/${n}`)!;
        expect(a.deliveryId).toBe(n <= 150 ? d1 : d2);
        expect(a.promisedDate).toBe(n <= 150 ? JAN_1 : JAN_15);
      }
      // Ordre 151 har fået leverance 2's dato på selve ordren i Shopify.
      expect(
        h.shopify.orders.get("gid://shopify/Order/151")!.metafields
          .promised_date,
      ).toBe(JAN_15);
      expect(plan1).not.toBe(plan2);

      // Efter 300: intet tilbage, ingen plan og ingen dato på produktsiden, og
      // Shopifys lager er 0 med «sælg ikke, når udsolgt».
      expect(await h.remaining()).toEqual([0, 0]);
      expect(h.metafield()).toMatchObject({
        date: null,
        sellingPlanId: null,
        remaining: 0,
        soldOut: true,
      });
      expect(h.available()).toBe(0);
      expect(h.shopify.variants.get(V1)!.inventoryPolicy).toBe("DENY");

      // Slipper en 301. ordre alligevel igennem (fx en kladdeordre), får den
      // ingen plads: den bliver uafklaret, og intet går i minus.
      await h.order(301, [{ quantity: 1, deliveryId: d2 }]);
      await h.run();
      const [extra] = await h.live(301);
      expect(extra).toMatchObject({ status: "UNRESOLVED", deliveryId: null });
      expect(await h.remaining()).toEqual([0, 0]);
    },
  );
});

// --- Punkt 5 -----------------------------------------------------------------

describe("varianter har hver sin leveranceplan", () => {
  it("én variant kan være udsolgt i leverance 1, mens en anden stadig sælges fra sin egen", async () => {
    const h = await setup([
      {
        variantId: V1,
        deliveries: [
          { date: JAN_1, quantity: 2 },
          { date: JAN_15, quantity: 5 },
        ],
      },
      { variantId: V2, deliveries: [{ date: JAN_1, quantity: 5 }] },
    ]);
    const v1d1 = h.delivery(V1, 0);
    const v1d2 = h.delivery(V1, 1);
    const v2d1 = h.delivery(V2, 0);
    // Hver variant og hver leverance har sin egen selling plan.
    const plans = await Promise.all([v1d1, v1d2, v2d1].map(h.planOf));
    expect(new Set(plans).size).toBe(3);

    // V1's første leverance sælges ud.
    await h.order(1, [{ variantId: V1, quantity: 2, deliveryId: v1d1 }]);
    await h.run();
    expect(await h.remaining(V1)).toEqual([0, 5]);
    expect(h.metafield(V1)).toMatchObject({ date: JAN_15, soldOut: false });

    // V2 er upåvirket: samme dato, samme lager, stadig til salg.
    expect(await h.remaining(V2)).toEqual([5]);
    expect(h.metafield(V2)).toMatchObject({
      date: JAN_1,
      sellingPlanId: plans[2],
      remaining: 5,
      soldOut: false,
    });
    expect(h.available(V2)).toBe(5);

    // Én ordre med begge varianter: hver linje følger sin egen variants plan.
    await h.order(2, [
      { variantId: V1, quantity: 1, deliveryId: v1d1 },
      { variantId: V2, quantity: 1, deliveryId: v2d1 },
    ]);
    await h.run();
    const lines = await h.live(2);
    expect(
      lines.map((l) => [l.variantId, l.deliveryId, l.promisedDate]).sort(),
    ).toEqual(
      [
        [V1, v1d2, JAN_15],
        [V2, v2d1, JAN_1],
      ].sort(),
    );
    expect(await h.remaining(V1)).toEqual([0, 4]);
    expect(await h.remaining(V2)).toEqual([4]);
    expect(h.available(V1)).toBe(4);
    expect(h.available(V2)).toBe(4);
  });
});

// --- Punkt 6 -----------------------------------------------------------------

describe("flere enheder end der er tilbage", () => {
  it("fylder den aktuelle leverance op, lægger resten i den næste med dens dato, og resten derudover bliver uafklaret", async () => {
    const h = await setup([
      {
        variantId: V1,
        deliveries: [
          { date: JAN_1, quantity: 3 },
          { date: JAN_15, quantity: 4 },
        ],
      },
    ]);
    const [d1, d2] = [h.delivery(V1, 0), h.delivery(V1, 1)];

    await h.order(1, [{ quantity: 5, deliveryId: d1 }]);
    await h.run();
    const first = await h.live(1);
    expect(
      first.map((a) => [a.deliveryId, a.quantity, a.promisedDate]),
    ).toEqual([
      [d1, 3, JAN_1],
      [d2, 2, JAN_15],
    ]);
    // Hele ordren sendes, når den sidste del kan sendes.
    expect(
      h.shopify.orders.get("gid://shopify/Order/1")!.metafields.promised_date,
    ).toBe(JAN_15);
    expect(await h.remaining()).toEqual([0, 2]);

    // 5 mere, men kun 2 tilbage: 2 får plads, 3 bliver uafklarede.
    await h.order(2, [{ quantity: 5, deliveryId: d2 }]);
    await h.run();
    const second = await h.live(2);
    expect(second.map((a) => [a.status, a.deliveryId, a.quantity])).toEqual([
      ["ACTIVE", d2, 2],
      ["UNRESOLVED", null, 3],
    ]);
    expect(h.shopify.orders.get("gid://shopify/Order/2")!.tags).toContain(
      "Forudbestilling uafklaret",
    );
    expect(await h.remaining()).toEqual([0, 0]);
    expect(h.available()).toBe(0);
  });
});

// --- Punkt 9 -----------------------------------------------------------------

describe("lagerændringer uden for appen", () => {
  it("lageret rettet ned i Shopify (uden ordre) ændrer ikke leverancerne, og appen skriver det rigtige tal tilbage", async () => {
    const h = await setup([
      { variantId: V1, deliveries: [{ date: JAN_1, quantity: 10 }] },
    ]);
    const d1 = h.delivery(V1, 0);
    await h.order(1, [{ quantity: 4, deliveryId: d1 }]);
    await h.run();
    expect(await h.remaining()).toEqual([6]);
    expect(h.available()).toBe(6);

    // Nogen retter lageret til 2 i Shopify (en anden app, en import, en
    // hånd). Der er ingen ordre bag.
    h.shopify.variants.get(V1)!.available = 2;
    await h.inventoryChange(1, 2);
    await h.run();

    expect(await h.remaining()).toEqual([6]);
    const live = await client.allocation.findMany({
      where: { shop: SHOP, status: "ACTIVE" },
    });
    expect(live.map((a) => a.quantity)).toEqual([4]);
    expect(h.available()).toBe(6);
  });

  it("opgave 4: et salg uden plan tælles, så næste synkronisering ikke skriver lageret op igen", async () => {
    // Fejlen i opgave 4: Shopify trak lageret ned for en ordrelinje uden
    // selling plan, appen talte den ikke, og næste synkronisering skrev
    // lageret op igen, så den samme enhed kunne sælges en gang til.
    const h = await setup([
      { variantId: V1, deliveries: [{ date: JAN_1, quantity: 10 }] },
    ]);
    h.shopify.variants.get(V1)!.available = 7; // Shopify har trukket 3
    // Ordren er oprettet efter, at forudbestilling blev slået til.
    await h.order(1, [{ quantity: 3 }], {
      createdAt: new Date(Date.now() + 1000).toISOString(),
    });
    await h.inventoryChange(1, 7);
    await h.run();

    expect(await h.remaining()).toEqual([7]);
    expect(h.available()).toBe(7);
    const [line] = await h.live(1);
    expect(line).toMatchObject({ quantity: 3, soldWithoutPlan: true });

    // En ny synkronisering ændrer intet.
    await h.sync(V1);
    expect(h.available()).toBe(7);
    expect(await h.remaining()).toEqual([7]);
  });
});

// --- Punkt 10 ----------------------------------------------------------------

describe("ændret leverancedato", () => {
  it("rører ikke datoen på ordrer, der allerede er afgivet; nye ordrer får den nye", async () => {
    const h = await setup([
      { variantId: V1, deliveries: [{ date: JAN_1, quantity: 10 }] },
    ]);
    const d1 = h.delivery(V1, 0);
    await h.order(1, [{ quantity: 2, deliveryId: d1 }]);
    await h.run();

    await data().deliveries.update(
      d1,
      { date: "2027-02-01", quantity: "10" },
      TODAY,
    );
    await h.sync(V1);
    // Ordren bliver opdateret i Shopify (fx en note), og afstemmes igen.
    await h.order(1, [{ quantity: 2, deliveryId: d1 }], {
      topic: "ORDERS_UPDATED",
    });
    await h.order(2, [{ quantity: 1, deliveryId: d1 }]);
    await h.run();

    const [old] = await h.live(1);
    expect(old.promisedDate).toBe(JAN_1);
    expect(
      h.shopify.orders.get("gid://shopify/Order/1")!.metafields.promised_date,
    ).toBe(JAN_1);
    const [fresh] = await h.live(2);
    expect(fresh.promisedDate).toBe("2027-02-01");
    expect(await h.remaining()).toEqual([7]);
  });
});
