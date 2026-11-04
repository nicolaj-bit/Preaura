import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../test/testDb";
import { enqueueWebhook } from "../lib/webhookQueue.server";
import { processShopQueue } from "../orders/processQueue.server";
import { queueFor } from "./queue.server";
import { complianceFor, purgeOldData } from "./compliance.server";

// GDPR gennem køen: dataanmodninger, sletning af kunde og af butik. Alt
// kører uden adgang til Shopify (deps: null), som efter en afinstallation.

const testDb = createTestDb();
const client = testDb.client;
const SHOP = "butik.myshopify.com";
const OTHER = "anden.myshopify.com";

beforeAll(() => testDb.setup());
afterAll(() => testDb.teardown());
beforeEach(() => testDb.reset());

let seq = 0;
async function webhook(topic: string, payload: unknown, shop = SHOP) {
  await enqueueWebhook(
    { webhookId: `wh-${++seq}`, shop, topic, payload },
    client,
  );
}

/** En butik med en leverance og en tildeling på ordre 1. */
async function shopWithOrder(shop = SHOP) {
  await client.shopSetting.create({ data: { shop } });
  await client.variantPlan.create({
    data: {
      shop,
      productId: "gid://shopify/Product/1",
      variantId: "gid://shopify/ProductVariant/1",
      inventoryItemId: "gid://shopify/InventoryItem/1",
      preorderEnabled: true,
      mode: "PREORDER",
    },
  });
  const delivery = await client.delivery.create({
    data: {
      shop,
      variantId: "gid://shopify/ProductVariant/1",
      position: 1,
      date: "2026-12-01",
      quantity: 10,
    },
  });
  await client.allocation.create({
    data: {
      shop,
      orderId: "gid://shopify/Order/1",
      orderName: "#1001",
      orderLineId: "gid://shopify/LineItem/1",
      variantId: "gid://shopify/ProductVariant/1",
      deliveryId: delivery.id,
      quantity: 2,
      promisedDate: "2026-12-01",
      orderCreatedAt: new Date("2026-11-02T10:00:00Z"),
    },
  });
  await client.modeChange.create({
    data: {
      shop,
      variantId: "gid://shopify/ProductVariant/1",
      mode: "PREORDER",
      reason: "test",
    },
  });
  await client.session.create({
    data: { id: `offline_${shop}`, shop, state: "", accessToken: "x" },
  });
}

const run = () => processShopQueue({ shop: SHOP, deps: null, client });
const customer = { id: 7, email: "kunde@example.com", phone: "+4512345678" };

describe("customers/data_request", () => {
  it("gemmer anmodningen med det, appen har om ordrerne — uden adgang til Shopify", async () => {
    await shopWithOrder();
    await webhook("CUSTOMERS_DATA_REQUEST", {
      customer,
      orders_requested: [1, 2],
      data_request: { id: 9 },
    });
    expect(await run()).toMatchObject({ ran: true, done: 1, failed: 0 });

    const [request] = await complianceFor(SHOP, client).dataRequests();
    expect(request).toMatchObject({
      customerId: "7",
      shopifyRequestId: "9",
      orderIds: ["gid://shopify/Order/1", "gid://shopify/Order/2"],
      answeredAt: null,
      data: [
        {
          orderId: "gid://shopify/Order/1",
          orderName: "#1001",
          lines: [
            {
              quantity: 2,
              status: "ACTIVE",
              promisedDate: "2026-12-01",
              orderedAt: "2026-11-02T10:00:00.000Z",
            },
          ],
        },
      ],
    });
    // Kundens mail og telefon er hverken i anmodningen eller i køen.
    const stored = JSON.stringify(
      await client.webhookEvent.findMany({ select: { payload: true } }),
    );
    expect(stored).not.toContain("kunde@example.com");
    expect(stored).not.toContain("12345678");
  });

  it("kan markeres som besvaret, og tælles så ikke længere som ventende", async () => {
    await webhook("CUSTOMERS_DATA_REQUEST", { customer, orders_requested: [] });
    await run();
    const compliance = complianceFor(SHOP, client);
    expect(await compliance.countUnansweredDataRequests()).toBe(1);
    const [request] = await compliance.dataRequests();
    expect(await compliance.markAnswered(request.id)).toBe(1);
    expect(await compliance.countUnansweredDataRequests()).toBe(0);
    // En anden butik kan ikke markere den.
    expect(await complianceFor(OTHER, client).markAnswered(request.id)).toBe(0);
  });
});

describe("customers/redact", () => {
  it("sletter kundens dataanmodninger og ordrehændelser — tildelingen bliver stående", async () => {
    await shopWithOrder();
    await webhook("CUSTOMERS_DATA_REQUEST", {
      customer,
      orders_requested: [1],
    });
    await run();
    // Behandlede ordrehændelser for kundens ordre og en anden ordre.
    await webhook("ORDERS_CREATE", { id: 1, created_at: "2026-11-02" });
    await webhook("ORDERS_CREATE", { id: 2, created_at: "2026-11-02" });
    const events = await client.webhookEvent.findMany({
      where: { topic: "ORDERS_CREATE" },
    });
    await queueFor(SHOP, client).markDone(events.map((e) => e.id));

    await webhook("CUSTOMERS_REDACT", { customer, orders_to_redact: [1] });
    expect(await run()).toMatchObject({ done: 1, failed: 0 });

    expect(await complianceFor(SHOP, client).dataRequests()).toHaveLength(0);
    const left = await client.webhookEvent.findMany({
      where: { topic: "ORDERS_CREATE" },
    });
    expect(left.map((e) => JSON.parse(e.payload).id)).toEqual([2]);
    // Regnskabet over pladserne er intakt, så pladsen ikke sælges igen.
    expect(await client.allocation.count({ where: { shop: SHOP } })).toBe(1);
  });

  it("en hændelse uden kunde lander på fejllisten", async () => {
    await webhook("CUSTOMERS_REDACT", { orders_to_redact: [1] });
    expect(await run()).toMatchObject({ done: 0, failed: 1 });
  });
});

describe("shop/redact", () => {
  it("sletter alt om butikken — men intet om andre butikker", async () => {
    await shopWithOrder(SHOP);
    await shopWithOrder(OTHER);
    await webhook("ORDERS_CREATE", { id: 1 });
    await webhook("ORDERS_CREATE", { id: 1 }, OTHER);
    await webhook("SHOP_REDACT", { shop_id: 1, shop_domain: SHOP });

    expect(await run()).toMatchObject({ ran: true });

    for (const table of [
      client.allocation,
      client.delivery,
      client.variantPlan,
      client.shopSetting,
      client.modeChange,
      client.session,
      client.webhookEvent,
      client.dataRequest,
    ] as unknown as { count(a: object): Promise<number> }[]) {
      expect(await table.count({ where: { shop: SHOP } })).toBe(0);
      if (table !== (client.dataRequest as unknown)) {
        expect(await table.count({ where: { shop: OTHER } })).toBeGreaterThan(
          0,
        );
      }
    }
  });
});

describe("uden adgang til Shopify", () => {
  it("behandles kun compliance; ordrer venter til der er adgang igen", async () => {
    await webhook("ORDERS_CREATE", { id: 1 });
    await webhook("CUSTOMERS_DATA_REQUEST", { customer, orders_requested: [] });
    expect(await run()).toMatchObject({ done: 1, failed: 0 });
    const pending = await queueFor(SHOP, client).pending();
    expect(pending.map((e) => e.topic)).toEqual(["ORDERS_CREATE"]);
  });
});

describe("opbevaringsperiode", () => {
  it("sletter behandlede hændelser og besvarede anmodninger efter 30 dage", async () => {
    const now = new Date("2026-12-31T12:00:00Z");
    const old = new Date("2026-11-20T12:00:00Z");
    const recent = new Date("2026-12-20T12:00:00Z");
    for (const [status, processedAt] of [
      ["DONE", old],
      ["SKIPPED", old],
      ["FAILED", old],
      ["DONE", recent],
    ] as const) {
      await client.webhookEvent.create({
        data: {
          webhookId: `p-${++seq}`,
          shop: SHOP,
          topic: "ORDERS_CREATE",
          payload: "{}",
          status,
          processedAt,
        },
      });
    }
    for (const answeredAt of [old, recent, null]) {
      await client.dataRequest.create({
        data: {
          shop: SHOP,
          customerId: "7",
          orderIds: "[]",
          data: "[]",
          answeredAt,
        },
      });
    }

    expect(await purgeOldData(client, now)).toEqual({
      events: 2,
      dataRequests: 1,
    });
    const statuses = (await client.webhookEvent.findMany()).map(
      (e) => e.status,
    );
    expect(statuses.sort()).toEqual(["DONE", "FAILED"]);
    expect(await client.dataRequest.count()).toBe(2);
  });
});

describe("migrationen", () => {
  it("skærer allerede gemte hændelser ned, så persondata forsvinder", async () => {
    const before = createTestDb();
    await before.setup((name) => name < "20261104120000");
    const full = {
      id: 1,
      admin_graphql_api_id: "gid://shopify/Order/1",
      created_at: "2026-11-02T10:00:00Z",
      email: "kunde@example.com",
      customer,
    };
    const rows: [string, unknown][] = [
      ["ORDERS_CREATE", full],
      ["REFUNDS_CREATE", { order_id: 1, note: "kunde@example.com" }],
      ["CUSTOMERS_REDACT", { customer, orders_to_redact: [1] }],
      ["APP_UNINSTALLED", { email: "ejer@example.com" }],
    ];
    for (const [topic, payload] of rows) {
      await before.client.webhookEvent.create({
        data: {
          webhookId: topic,
          shop: SHOP,
          topic,
          payload: JSON.stringify(payload),
        },
      });
    }
    await before.client.webhookEvent.create({
      data: { webhookId: "bad", shop: SHOP, topic: "X", payload: "ikke json" },
    });
    await before.setup((name) => name.startsWith("20261104120000"));

    const after = Object.fromEntries(
      (await before.client.webhookEvent.findMany()).map((e) => [
        e.topic,
        JSON.parse(e.payload),
      ]),
    );
    expect(after).toEqual({
      ORDERS_CREATE: {
        id: 1,
        admin_graphql_api_id: "gid://shopify/Order/1",
        created_at: "2026-11-02T10:00:00Z",
      },
      REFUNDS_CREATE: { order_id: 1 },
      CUSTOMERS_REDACT: { orders_to_redact: [1], customer: { id: 7 } },
      APP_UNINSTALLED: {},
      X: {},
    });
    await before.teardown();
  });
});
