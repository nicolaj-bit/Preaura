import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { forShop, type OrderSnapshot } from "../models/preorder.server";
import { releaseFor } from "../models/release.server";
import { enqueueWebhook } from "../lib/webhookQueue.server";
import { createTestDb } from "../test/testDb";
import { createFakeShopify } from "../test/fakeShopify";
import { syncVariant } from "../sync/syncVariant.server";
import { syncOrder } from "../sync/syncOrder.server";
import { processShopQueue } from "../orders/processQueue.server";
import { cancelLink, readCancelLink } from "./link.server";
import { cancelState, escape, targetsFromSelection } from "./cancel";
import { applyTargets } from "./process.server";
import { parseReleaseSettings } from "./settings";

// Frigivelse hele vejen: anmodning eller afvist betaling → ordren rettes i
// (en simuleret) Shopify → den eksisterende afstemning frigiver enhederne.

process.env.PREAURA_ENCRYPTION_KEY = "test-nøgle";

const testDb = createTestDb();
const client = testDb.client;
const SHOP = "butik.myshopify.com";
const VARIANT = "gid://shopify/ProductVariant/1";
const ORDER = "gid://shopify/Order/1";
const LINE = "gid://shopify/LineItem/1";
const TODAY = "2026-11-02";
const DAY = 24 * 60 * 60 * 1000;

beforeAll(() => testDb.setup());
afterAll(() => testDb.teardown());
beforeEach(() => testDb.reset());

const data = () => forShop(SHOP, client);
const release = () => releaseFor(SHOP, client);

async function setup({ quantity = 5, access = true } = {}) {
  await data().variantPlans.addVariants([
    {
      productId: "gid://shopify/Product/1",
      variantId: VARIANT,
      inventoryItemId: "gid://shopify/InventoryItem/1",
      locationId: "gid://shopify/Location/1",
    },
  ]);
  await data().variantPlans.setEnabled(VARIANT, true);
  const delivery = await data().deliveries.create(
    VARIANT,
    { date: "2026-12-01", quantity: "10" },
    TODAY,
  );
  const shopify = createFakeShopify();
  shopify.addVariant(VARIANT, { available: 0 });
  const syncNow = () =>
    syncVariant({
      shop: SHOP,
      variantId: VARIANT,
      gateway: shopify.gateway,
      client,
    });
  expect((await syncNow()).ok).toBe(true);
  const plan = (
    await client.delivery.findUniqueOrThrow({ where: { id: delivery.id } })
  ).sellingPlanId!;

  const order: OrderSnapshot = {
    id: ORDER,
    name: "#1001",
    createdAt: new Date("2026-11-02T10:00:00Z").toISOString(),
    cancelled: false,
    lines: [
      {
        id: LINE,
        variantId: VARIANT,
        sellingPlanId: plan,
        quantity,
        unfulfilled: quantity,
        title: "Kjole",
        variantTitle: "M",
      },
    ],
    payment: { paid: false, failedAt: null },
  };
  shopify.putOrder(order);

  let seq = 0;
  let hasAccess = access;
  const h = {
    shopify,
    delivery,
    order,
    setAccess(v: boolean) {
      hasAccess = v;
    },
    /** Opdaterer ordren i Shopify og sender en webhook. */
    async webhook(
      topic = "ORDERS_UPDATED",
      change?: (o: OrderSnapshot) => void,
    ) {
      if (change) {
        const current = (await shopify.gateway.readOrder(ORDER))!.snapshot;
        change(current);
        shopify.putOrder(current);
      }
      await enqueueWebhook(
        {
          webhookId: `wh-${++seq}`,
          shop: SHOP,
          topic,
          payload:
            topic === "ORDER_TRANSACTIONS_CREATE"
              ? { order_id: 1, kind: "sale", status: "failure" }
              : { admin_graphql_api_id: ORDER, created_at: order.createdAt },
        },
        client,
      );
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
          cancelOrder: shopify.gateway.cancelOrder,
          setOrderLineQuantities: shopify.gateway.setOrderLineQuantities,
          hasAccess: async () => hasAccess,
        },
      }),
    async remaining() {
      const [view] = await data().deliveries.listForVariants([VARIANT]);
      return view.remaining;
    },
    async active() {
      return client.allocation.findMany({
        where: { orderId: ORDER, status: "ACTIVE" },
      });
    },
    async shopifyOrder() {
      return (await shopify.gateway.readOrder(ORDER))!.snapshot;
    },
    writes: (method: string) =>
      shopify.writes.filter((w) => w.method === method).length,
  };
  await h.webhook("ORDERS_CREATE");
  await h.run();
  expect(await h.remaining()).toBe(10 - quantity);
  return h;
}

/** Kunden annullerer `n` af linjens enheder (som annulleringssiden gør). */
async function customerCancels(n: number, approve = true) {
  const order = (await createFakeOrderState())!;
  const state = cancelState(
    order,
    await release().activeByLine(ORDER),
    await release().settings(),
    new Date("2026-11-03T10:00:00Z"),
  );
  if (!state.ok) throw new Error(state.reason);
  return release().cancellations.request({
    orderId: ORDER,
    orderName: "#1001",
    targets: targetsFromSelection(state.lines, { [LINE]: n }),
    source: "CUSTOMER",
    approve,
  });
}
let currentShopify: ReturnType<typeof createFakeShopify> | null = null;
const createFakeOrderState = async () =>
  (await currentShopify!.gateway.readOrder(ORDER))?.snapshot ?? null;

describe("én frigivelse — kundens annullering", () => {
  it("delvis: annullerer kunden 2 af 5, frigives 2; de 3 beholder plads og dato", async () => {
    const h = await setup({ quantity: 5 });
    currentShopify = h.shopify;
    const before = await h.active();
    await customerCancels(2);
    await h.run();

    expect((await h.shopifyOrder()).lines[0].quantity).toBe(3);
    expect(await h.remaining()).toBe(7);
    const after = await h.active();
    expect(after.reduce((n, a) => n + a.quantity, 0)).toBe(3);
    expect(after.every((a) => a.deliveryId === h.delivery.id)).toBe(true);
    expect(after[0].promisedDate).toBe(before[0].promisedDate);
    // Ordren blev rettet, ikke annulleret.
    expect(h.writes("cancelOrder")).toBe(0);
  });

  it("præcis én gang: dobbeltklik, link åbnet to gange og gentagne webhooks", async () => {
    const h = await setup({ quantity: 5 });
    currentShopify = h.shopify;
    const first = await customerCancels(2, false);
    const second = await customerCancels(2, false); // Linket sendt igen.
    expect(second?.id).toBe(first?.id);
    expect(await release().cancellations.approve(first!.id)).toBe(1);
    expect(await release().cancellations.approve(first!.id)).toBe(0); // Dobbeltklik.
    await h.run();
    await h.run();
    await h.webhook("ORDERS_UPDATED");
    await h.webhook("ORDERS_EDITED");
    await h.run();
    expect(await h.remaining()).toBe(7);
    expect((await h.shopifyOrder()).lines[0].quantity).toBe(3);
    expect(h.writes("setOrderLineQuantities")).toBe(1);
  });

  it("alt annulleres: hele ordren annulleres i Shopify — uden refundering — og alle 5 frigives", async () => {
    const h = await setup({ quantity: 5 });
    currentShopify = h.shopify;
    await customerCancels(5);
    await h.run();
    expect((await h.shopifyOrder()).cancelled).toBe(true);
    expect(await h.remaining()).toBe(10);
    const [call] = h.shopify.writes.filter((w) => w.method === "cancelOrder");
    expect(call.args).toEqual([ORDER, "CUSTOMER"]);
    const events = await client.outboxEvent.findMany({
      where: { type: "preorder.cancelled" },
    });
    expect(events).toHaveLength(1);
  });

  it("butikken annullerer i Shopify: den samme afstemning frigiver", async () => {
    const h = await setup({ quantity: 5 });
    await h.webhook("ORDERS_CANCELLED", (o) => {
      o.cancelled = true;
    });
    await h.run();
    expect(await h.remaining()).toBe(10);
  });

  it("manuel godkendelse: intet frigives, før butikken godkender", async () => {
    const h = await setup({ quantity: 5 });
    currentShopify = h.shopify;
    const request = await customerCancels(2, false);
    await h.run();
    expect(await h.remaining()).toBe(5);
    await release().cancellations.approve(request!.id);
    await h.run();
    expect(await h.remaining()).toBe(7);
  });

  it("uden abonnement venter godkendte annulleringer — intet slettes", async () => {
    const h = await setup({ quantity: 5 });
    currentShopify = h.shopify;
    h.setAccess(false);
    await customerCancels(2);
    await h.run();
    expect(await h.remaining()).toBe(5);
    expect((await release().cancellations.approved()).length).toBe(1);
  });
});

describe("én frigivelse — afvist betaling", () => {
  const decline = (h: Awaited<ReturnType<typeof setup>>) =>
    h.webhook("ORDER_TRANSACTIONS_CREATE", (o) => {
      o.payment = { paid: false, failedAt: "2026-11-10T09:00:00.000Z" };
    });

  it("frigives ikke med det samme — først efter fristen, gennem samme mekanisme", async () => {
    const h = await setup({ quantity: 5 });
    await decline(h);
    await h.run();
    const [issue] = await client.paymentIssue.findMany();
    expect(issue.status).toBe("OPEN");
    expect(issue.releaseAt.getTime() - Date.now()).toBeGreaterThan(6 * DAY);
    expect(await h.remaining()).toBe(5);
    // Hændelsen udsendes én gang, også ved gentagne webhooks.
    await decline(h);
    await h.run();
    expect(
      await client.outboxEvent.count({
        where: { type: "preorder.payment_failed" },
      }),
    ).toBe(1);

    // Fristen passeret (butikken frigiver nu).
    await release().payments.releaseNow(issue.id);
    await h.run();
    await h.run();
    expect((await h.shopifyOrder()).cancelled).toBe(true);
    expect(await h.remaining()).toBe(10);
    expect((await client.paymentIssue.findFirstOrThrow()).status).toBe(
      "RELEASED",
    );
    expect(h.writes("cancelOrder")).toBe(1);
    const [call] = h.shopify.writes.filter((w) => w.method === "cancelOrder");
    expect(call.args).toEqual([ORDER, "DECLINED"]);
  });

  it("kunden betaler inden fristen: sagen lukkes, intet frigives", async () => {
    const h = await setup({ quantity: 5 });
    await decline(h);
    await h.run();
    await h.webhook("ORDER_TRANSACTIONS_CREATE", (o) => {
      o.payment = { paid: true, failedAt: "2026-11-10T09:00:00.000Z" };
    });
    await h.run();
    expect((await client.paymentIssue.findFirstOrThrow()).status).toBe("PAID");
    expect(await h.remaining()).toBe(5);
  });

  it("butikken kan forlænge fristen", async () => {
    const h = await setup({ quantity: 5 });
    await decline(h);
    await h.run();
    const issue = await client.paymentIssue.findFirstOrThrow();
    await release().payments.extend(issue.id, 7);
    const later = await client.paymentIssue.findFirstOrThrow();
    expect(later.releaseAt.getTime() - issue.releaseAt.getTime()).toBe(7 * DAY);
  });

  it("overblikket viser hvornår og hvilken leverance", async () => {
    const h = await setup({ quantity: 5 });
    await decline(h);
    await h.run();
    const [row] = await release().payments.list();
    expect(row.failedAt.toISOString()).toBe("2026-11-10T09:00:00.000Z");
    expect(row.deliveries).toEqual([
      expect.objectContaining({
        deliveryId: h.delivery.id,
        date: "2026-12-01",
        quantity: 5,
      }),
    ]);
  });
});

describe("regler for kundens annullering", () => {
  const order = (
    over: Partial<OrderSnapshot["lines"][number]> = {},
  ): OrderSnapshot => ({
    id: ORDER,
    name: "#1001",
    createdAt: "2026-11-02T10:00:00.000Z",
    cancelled: false,
    lines: [
      {
        id: LINE,
        variantId: VARIANT,
        sellingPlanId: null,
        quantity: 5,
        unfulfilled: 5,
        title: "Kjole",
        ...over,
      },
    ],
  });
  const active = new Map([[LINE, { quantity: 5, dates: ["2026-12-01"] }]]);
  const settings = {
    cancelWindow: "UNTIL_FULFILLED" as const,
    cancelDays: 14,
    cancelApproval: "MANUAL" as const,
    cancelAutoDays: 14,
    paymentGraceDays: 7,
  };

  it("indtil varen er sendt: sendte enheder kan ikke annulleres", () => {
    const state = cancelState(order({ unfulfilled: 2 }), active, settings);
    expect(state.ok && state.lines[0].cancellable).toBe(2);
    expect(cancelState(order({ unfulfilled: 0 }), active, settings)).toEqual({
      ok: false,
      reason: "window_closed",
    });
  });

  it("dage efter bestilling", () => {
    const days = { ...settings, cancelWindow: "DAYS" as const, cancelDays: 3 };
    expect(
      cancelState(order(), active, days, new Date("2026-11-04T10:00:00Z")).ok,
    ).toBe(true);
    expect(
      cancelState(order(), active, days, new Date("2026-11-06T10:00:00Z")),
    ).toEqual({
      ok: false,
      reason: "window_closed",
    });
  });

  it("automatisk godkendelse kun inden for butikkens tidsrum", () => {
    const auto = {
      ...settings,
      cancelApproval: "AUTO" as const,
      cancelAutoDays: 2,
    };
    const early = cancelState(
      order(),
      active,
      auto,
      new Date("2026-11-03T10:00:00Z"),
    );
    const late = cancelState(
      order(),
      active,
      auto,
      new Date("2026-11-05T10:00:00Z"),
    );
    expect(early.ok && early.autoApprove).toBe(true);
    expect(late.ok && late.autoApprove).toBe(false);
  });

  it("valg klippes til det lovlige", () => {
    const state = cancelState(order(), active, settings);
    if (!state.ok) throw new Error();
    expect(targetsFromSelection(state.lines, { [LINE]: 99 })).toEqual([
      { lineId: LINE, quantity: 0, from: 5 },
    ]);
    expect(targetsFromSelection(state.lines, { [LINE]: "x" })).toEqual([]);
  });

  it("allerede sendte enheder røres aldrig, selv om målet er lavere", async () => {
    const calls: unknown[] = [];
    await applyTargets(
      order({ unfulfilled: 3 }),
      [{ lineId: LINE, quantity: 0 }],
      "CUSTOMER",
      {
        cancelOrder: async () => {
          calls.push("cancel");
        },
        setOrderLineQuantities: async (_id, targets) => {
          calls.push(targets);
        },
      },
    );
    expect(calls).toEqual([[{ lineId: LINE, quantity: 2 }]]);
  });

  it("annullering kan ikke slås fra: mindst 1 dag", () => {
    const bad = parseReleaseSettings({
      cancelWindow: "DAYS",
      cancelDays: "0",
      cancelApproval: "MANUAL",
      cancelAutoDays: "14",
      paymentGraceDays: "7",
    });
    expect(bad.ok).toBe(false);
    expect(parseReleaseSettings({ cancelWindow: "OFF" }).ok).toBe(false);
  });
});

describe("annulleringslinket", () => {
  const settings = { cancelWindow: "DAYS" as const, cancelDays: 14 };
  const created = new Date("2026-11-02T10:00:00Z");
  const params = (url: string) => {
    const q = new URL(url).searchParams;
    return { o: q.get("o"), x: q.get("x"), s: q.get("s") };
  };

  it("gælder kun den ene ordre i den ene butik og kan ikke ændres", () => {
    const url = cancelLink(SHOP, ORDER, created, settings);
    expect(url).toMatch(
      /^https:\/\/butik\.myshopify\.com\/apps\/preaura\/cancel\?/,
    );
    const p = params(url);
    const now = new Date("2026-11-03T10:00:00Z");
    expect(readCancelLink(SHOP, p, now)).toBe(ORDER);
    expect(readCancelLink("anden.myshopify.com", p, now)).toBeNull();
    expect(readCancelLink(SHOP, { ...p, o: "2" }, now)).toBeNull();
    expect(
      readCancelLink(SHOP, { ...p, x: String(Number(p.x) + 999999) }, now),
    ).toBeNull();
    expect(readCancelLink(SHOP, { ...p, s: "a".repeat(32) }, now)).toBeNull();
    expect(p.s).toHaveLength(32);
  });

  it("udløber", () => {
    const p = params(cancelLink(SHOP, ORDER, created, settings));
    expect(
      readCancelLink(SHOP, p, new Date("2026-11-20T10:00:00Z")),
    ).toBeNull();
  });

  it("siden kan ikke snydes til at køre Liquid eller HTML fra et produktnavn", () => {
    expect(escape("{{ shop.secret }}<script>")).toBe(
      "&#123;&#123; shop.secret &#125;&#125;&lt;script&gt;",
    );
  });
});
