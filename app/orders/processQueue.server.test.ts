import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { forShop, type OrderSnapshot } from "../models/preorder.server";
import { queueFor } from "../models/queue.server";
import { enqueueWebhook } from "../lib/webhookQueue.server";
import { createTestDb } from "../test/testDb";
import { createFakeShopify } from "../test/fakeShopify";
import { syncVariant } from "../sync/syncVariant.server";
import { syncOrder } from "../sync/syncOrder.server";
import { processShopQueue } from "./processQueue.server";

// Hele vejen: webhook i kø → behandling → tildelinger → lager og ordrefelter
// i (en simuleret) Shopify. Databasen er en rigtig SQLite med appens
// migrationer.

const testDb = createTestDb();
const client = testDb.client;
const SHOP = "butik.myshopify.com";
const VARIANT = "gid://shopify/ProductVariant/1";
const TODAY = "2026-11-02";
const data = () => forShop(SHOP, client);

beforeAll(() => testDb.setup());
afterAll(() => testDb.teardown());
beforeEach(() => testDb.reset());

/** Variant med leverancer, synkroniseret, så hver leverance har sin plan. */
async function setup(deliveries: { date: string; quantity: number }[]) {
  await data().variantPlans.addVariants([
    {
      productId: "gid://shopify/Product/1",
      variantId: VARIANT,
      inventoryItemId: "gid://shopify/InventoryItem/1",
      locationId: "gid://shopify/Location/1",
    },
  ]);
  await data().variantPlans.setEnabled(VARIANT, true);
  const ids: string[] = [];
  for (const d of deliveries) {
    ids.push(
      (
        await data().deliveries.create(
          VARIANT,
          { date: d.date, quantity: String(d.quantity) },
          TODAY,
        )
      ).id,
    );
  }
  const shopify = createFakeShopify();
  shopify.addVariant(VARIANT);
  const syncNow = () =>
    syncVariant({
      shop: SHOP,
      variantId: VARIANT,
      gateway: shopify.gateway,
      client,
    });
  expect((await syncNow()).ok).toBe(true);

  const planOf = async (deliveryId: string) =>
    (await client.delivery.findUniqueOrThrow({ where: { id: deliveryId } }))
      .sellingPlanId!;

  let webhookSeq = 0;
  const harness = {
    shopify,
    ids,
    syncNow,
    planOf,
    /** Lægger (eller opdaterer) en ordre i Shopify og sender en webhook. */
    async order(
      n: number,
      lines: { quantity: number; deliveryId: string; lineNo?: number }[],
      opts: {
        topic?: string;
        cancelled?: boolean;
        createdAt?: string;
        webhookId?: string;
      } = {},
    ) {
      const snapshot: OrderSnapshot = {
        id: `gid://shopify/Order/${n}`,
        name: `#${1000 + n}`,
        createdAt:
          opts.createdAt ??
          new Date(Date.UTC(2026, 10, 2, 10, 0, n)).toISOString(),
        cancelled: opts.cancelled ?? false,
        lines: await Promise.all(
          lines.map(async (line, i) => ({
            id: `gid://shopify/LineItem/${n}-${line.lineNo ?? i}`,
            variantId: VARIANT,
            sellingPlanId: await planOf(line.deliveryId),
            quantity: line.quantity,
          })),
        ),
      };
      shopify.putOrder(snapshot);
      await enqueueWebhook(
        {
          webhookId: opts.webhookId ?? `wh-${++webhookSeq}`,
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
    run: () =>
      processShopQueue({
        shop: SHOP,
        client,
        deps: {
          readOrder: async (id) =>
            (await shopify.gateway.readOrder(id))?.snapshot ?? null,
          syncVariant: (variantId) =>
            syncVariant({
              shop: SHOP,
              variantId,
              gateway: shopify.gateway,
              client,
            }),
          syncOrder: (orderId) =>
            syncOrder({
              shop: SHOP,
              orderId,
              gateway: shopify.gateway,
              client,
            }),
        },
      }),
    async active(orderNo: number) {
      return client.allocation.findMany({
        where: {
          orderId: `gid://shopify/Order/${orderNo}`,
          status: { in: ["ACTIVE", "UNRESOLVED"] },
        },
        orderBy: { quantity: "asc" },
      });
    },
    async remaining() {
      const views = await data().deliveries.listForVariants([VARIANT]);
      return views.map((v) => v.remaining);
    },
  };
  return harness;
}

describe("jeres scenarier", () => {
  it("ordre nummer 151 lander i leverance 2", async () => {
    const h = await setup([
      { date: "2026-12-01", quantity: 150 },
      { date: "2027-01-15", quantity: 50 },
    ]);
    for (let n = 1; n <= 151; n++) {
      await h.order(n, [{ quantity: 1, deliveryId: h.ids[0] }]);
    }
    const result = await h.run();
    expect(result).toEqual({ ran: true, done: 151, failed: 0, skipped: 0 });

    expect((await h.active(150))[0].deliveryId).toBe(h.ids[0]);
    const [last] = await h.active(151);
    expect(last).toMatchObject({
      deliveryId: h.ids[1],
      status: "ACTIVE",
      promisedDate: "2027-01-15",
    });
    expect(await h.remaining()).toEqual([0, 49]);
    // Shopifys lager følger det resterende i den aktive leverance.
    expect(h.shopify.variants.get(VARIANT)?.available).toBe(49);
  });

  it("den der bestilte først, får pladsen — uanset hvornår webhooken kom", async () => {
    const h = await setup([
      { date: "2026-12-01", quantity: 1 },
      { date: "2027-01-15", quantity: 10 },
    ]);
    // Ordre 2 (bestilt senere) kommer frem FØR ordre 1.
    await h.order(2, [{ quantity: 1, deliveryId: h.ids[0] }]);
    await h.order(1, [{ quantity: 1, deliveryId: h.ids[0] }]);
    await h.run();

    expect((await h.active(1))[0].deliveryId).toBe(h.ids[0]);
    expect((await h.active(2))[0].deliveryId).toBe(h.ids[1]);
  });

  it("en annullering frigiver pladsen igen — uden at slette tildelingen", async () => {
    const h = await setup([{ date: "2026-12-01", quantity: 5 }]);
    await h.order(1, [{ quantity: 3, deliveryId: h.ids[0] }]);
    await h.run();
    expect(await h.remaining()).toEqual([2]);

    await h.order(1, [{ quantity: 3, deliveryId: h.ids[0] }], {
      topic: "ORDERS_CANCELLED",
      cancelled: true,
    });
    await h.run();

    expect(await h.remaining()).toEqual([5]);
    expect(h.shopify.variants.get(VARIANT)?.available).toBe(5);
    const rows = await client.allocation.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "CANCELLED", quantity: 3 });
  });

  it("et ændret antal regnes rigtigt — både op og ned", async () => {
    const h = await setup([
      { date: "2026-12-01", quantity: 4 },
      { date: "2027-01-15", quantity: 10 },
    ]);
    await h.order(1, [{ quantity: 2, deliveryId: h.ids[0] }]);
    await h.run();
    expect(await h.remaining()).toEqual([2, 10]);

    // Op: 2 → 6. To stk. mere i leverance 1, resten i leverance 2.
    await h.order(1, [{ quantity: 6, deliveryId: h.ids[0] }], {
      topic: "ORDERS_UPDATED",
    });
    await h.run();
    expect(await h.remaining()).toEqual([0, 8]);

    // Ned: 6 → 1. Det fjernes bagfra, så kunden beholder den tidligste dato.
    await h.order(1, [{ quantity: 1, deliveryId: h.ids[0] }], {
      topic: "ORDERS_UPDATED",
    });
    await h.run();
    expect(await h.remaining()).toEqual([3, 10]);
    const active = await h.active(1);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ deliveryId: h.ids[0], quantity: 1 });

    // Historikken er bevaret: intet er slettet, kun annulleret.
    const all = await client.allocation.findMany();
    expect(all.filter((r) => r.status === "CANCELLED").length).toBeGreaterThan(
      0,
    );
  });

  it("den samme webhook sendt to gange tæller kun én gang", async () => {
    const h = await setup([{ date: "2026-12-01", quantity: 10 }]);
    await h.order(1, [{ quantity: 3, deliveryId: h.ids[0] }], {
      webhookId: "samme",
    });
    await h.order(1, [{ quantity: 3, deliveryId: h.ids[0] }], {
      webhookId: "samme",
    });
    await h.run();
    expect(await h.remaining()).toEqual([7]);

    // Også når den samme ordre kommer igen som en ny hændelse (fx updated
    // uden ændringer, eller en gensendelse med nyt id).
    await h.order(1, [{ quantity: 3, deliveryId: h.ids[0] }], {
      topic: "ORDERS_UPDATED",
    });
    await h.order(1, [{ quantity: 3, deliveryId: h.ids[0] }]);
    await h.run();
    expect(await h.remaining()).toEqual([7]);
    expect(await client.allocation.count()).toBe(1);
  });
});

describe("ordrens løfte og tag", () => {
  it("skriver leveringsdato som metafelt og tagger ordren", async () => {
    const h = await setup([{ date: "2026-12-01", quantity: 10 }]);
    const order = await h.order(1, [{ quantity: 2, deliveryId: h.ids[0] }]);
    await h.run();

    const state = h.shopify.orders.get(order.id)!;
    expect(state.tags).toEqual(["Forudbestilling"]);
    expect(state.metafields.promised_date).toBe("2026-12-01");
    expect(JSON.parse(state.metafields.allocations!)).toEqual([
      {
        line_item_id: order.lines[0].id,
        variant_id: VARIANT,
        delivery: 1,
        promised_date: "2026-12-01",
        quantity: 2,
        status: "allocated",
      },
    ]);
  });

  it("løftet er frosset: en senere ændret leverancedato rører ikke ordren", async () => {
    const h = await setup([{ date: "2026-12-01", quantity: 10 }]);
    const order = await h.order(1, [{ quantity: 2, deliveryId: h.ids[0] }]);
    await h.run();

    await data().deliveries.update(
      h.ids[0],
      { date: "2027-03-01", quantity: "10" },
      TODAY,
    );
    await h.syncNow();
    h.shopify.clearWrites();
    await h.order(1, [{ quantity: 2, deliveryId: h.ids[0] }], {
      topic: "ORDERS_UPDATED",
    });
    await h.run();

    expect(h.shopify.orders.get(order.id)!.metafields.promised_date).toBe(
      "2026-12-01",
    );
    expect(h.shopify.writes.map((w) => w.method)).not.toContain(
      "setOrderMetafields",
    );
  });

  it("anden behandling af samme ordre skriver intet til Shopify", async () => {
    const h = await setup([{ date: "2026-12-01", quantity: 10 }]);
    await h.order(1, [{ quantity: 2, deliveryId: h.ids[0] }]);
    await h.run();
    h.shopify.clearWrites();

    await h.order(1, [{ quantity: 2, deliveryId: h.ids[0] }], {
      topic: "ORDERS_UPDATED",
    });
    await h.run();
    expect(h.shopify.writes).toEqual([]);
  });

  it("ordrelinjer uden appens planer ignoreres, og ordren tagges ikke", async () => {
    const h = await setup([{ date: "2026-12-01", quantity: 10 }]);
    const order: OrderSnapshot = {
      id: "gid://shopify/Order/9",
      name: "#1009",
      createdAt: "2026-11-02T10:00:00Z",
      cancelled: false,
      lines: [
        {
          id: "gid://shopify/LineItem/9",
          variantId: VARIANT,
          sellingPlanId: null,
          quantity: 1,
        },
      ],
    };
    h.shopify.putOrder(order);
    await enqueueWebhook(
      {
        webhookId: "x",
        shop: SHOP,
        topic: "ORDERS_CREATE",
        payload: { admin_graphql_api_id: order.id },
      },
      client,
    );
    expect((await h.run()).ran).toBe(true);
    expect(await client.allocation.count()).toBe(0);
    expect(h.shopify.orders.get(order.id)!.tags).toEqual([]);
  });
});

describe("ingen plads", () => {
  it("opretter en uafklaret tildeling, tagger ordren — og afklarer den, når der kommer plads", async () => {
    const h = await setup([{ date: "2026-12-01", quantity: 1 }]);
    const order = await h.order(1, [{ quantity: 3, deliveryId: h.ids[0] }]);
    await h.run();

    const rows = await h.active(1);
    expect(rows.map((r) => [r.status, r.quantity])).toEqual([
      ["ACTIVE", 1],
      ["UNRESOLVED", 2],
    ]);
    expect(await data().orders.unresolved()).toHaveLength(1);
    expect(h.shopify.orders.get(order.id)!.tags).toContain(
      "Forudbestilling uafklaret",
    );

    // Webshopejeren opretter en ny leverance og behandler ordren igen.
    await data().deliveries.create(
      VARIANT,
      { date: "2027-02-01", quantity: "5" },
      TODAY,
    );
    await h.syncNow();
    await h.order(1, [{ quantity: 3, deliveryId: h.ids[0] }], {
      topic: "ORDERS_UPDATED",
    });
    await h.run();

    expect((await h.active(1)).map((r) => [r.status, r.quantity])).toEqual([
      ["ACTIVE", 1],
      ["ACTIVE", 2],
    ]);
    expect(await data().orders.unresolved()).toHaveLength(0);
    expect(h.shopify.orders.get(order.id)!.tags).toEqual(["Forudbestilling"]);
  });
});

describe("refunderinger", () => {
  it("en refundering frigiver de refunderede stk.", async () => {
    const h = await setup([{ date: "2026-12-01", quantity: 10 }]);
    const order = await h.order(1, [{ quantity: 4, deliveryId: h.ids[0] }]);
    await h.run();

    // Shopify: currentQuantity falder til 1 efter refundering af 3 stk.
    h.shopify.putOrder({
      ...order,
      lines: [{ ...order.lines[0], quantity: 1 }],
    });
    await enqueueWebhook(
      {
        webhookId: "refund-1",
        shop: SHOP,
        topic: "REFUNDS_CREATE",
        payload: { order_id: 1 },
      },
      client,
    );
    await h.run();
    expect(await h.remaining()).toEqual([9]);
  });
});

describe("fejl og samtidighed", () => {
  it("en hændelse, der ikke kan behandles, lander på fejllisten og kan prøves igen", async () => {
    const h = await setup([{ date: "2026-12-01", quantity: 10 }]);
    await enqueueWebhook(
      {
        webhookId: "w",
        shop: SHOP,
        topic: "ORDERS_CREATE",
        payload: { admin_graphql_api_id: "gid://shopify/Order/77" },
      },
      client,
    );
    expect(await h.run()).toMatchObject({ failed: 1 });
    const [failed] = await queueFor(SHOP, client).failed();
    expect(failed.lastError).toContain("Ordren findes ikke");

    // Ordren dukker op i Shopify; webshopejeren trykker «Prøv igen».
    h.shopify.putOrder({
      id: "gid://shopify/Order/77",
      name: "#1077",
      createdAt: "2026-11-02T10:00:00Z",
      cancelled: false,
      lines: [
        {
          id: "gid://shopify/LineItem/77",
          variantId: VARIANT,
          sellingPlanId: await h.planOf(h.ids[0]),
          quantity: 1,
        },
      ],
    });
    expect(await queueFor(SHOP, client).retry(failed.id)).toBe(1);
    expect(await h.run()).toMatchObject({ done: 1, failed: 0 });
    expect(await h.remaining()).toEqual([9]);
  });

  it("fejler skrivningen på ordren, er tildelingen gemt, og hændelsen står som fejlet", async () => {
    const h = await setup([{ date: "2026-12-01", quantity: 10 }]);
    await h.order(1, [{ quantity: 1, deliveryId: h.ids[0] }]);
    h.shopify.failNext("setOrderMetafields", "Access denied");
    expect(await h.run()).toMatchObject({ failed: 1 });

    expect(await h.remaining()).toEqual([9]);
    const [failed] = await queueFor(SHOP, client).failed();
    expect(failed.lastError).toContain("Access denied");

    await queueFor(SHOP, client).retry();
    expect(await h.run()).toMatchObject({ done: 1 });
    expect(await h.remaining()).toEqual([9]);
  });

  it("to behandlere kan ikke køre samtidig på samme butik", async () => {
    const h = await setup([{ date: "2026-12-01", quantity: 10 }]);
    await h.order(1, [{ quantity: 1, deliveryId: h.ids[0] }]);
    expect(await queueFor(SHOP, client).acquireLock("en-anden")).toBe(true);

    expect(await h.run()).toEqual({ ran: false });
    expect(await queueFor(SHOP, client).pending()).toHaveLength(1);

    await queueFor(SHOP, client).releaseLock("en-anden");
    expect(await h.run()).toMatchObject({ ran: true, done: 1 });
  });

  it("to samtidige kørsler tæller kun ordren én gang", async () => {
    const h = await setup([{ date: "2026-12-01", quantity: 10 }]);
    await h.order(1, [{ quantity: 2, deliveryId: h.ids[0] }]);
    await Promise.all([h.run(), h.run(), h.run()]);
    expect(await h.remaining()).toEqual([8]);
  });

  it("andre emner (fx compliance) markeres som ikke behandlet og blokerer ikke køen", async () => {
    const h = await setup([{ date: "2026-12-01", quantity: 10 }]);
    await enqueueWebhook(
      { webhookId: "c", shop: SHOP, topic: "SHOP_REDACT", payload: {} },
      client,
    );
    expect(await h.run()).toMatchObject({ skipped: 1 });
    expect(await queueFor(SHOP, client).pending()).toHaveLength(0);
  });
});
