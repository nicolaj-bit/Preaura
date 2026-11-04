import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../test/testDb";
import { createFakeShopify } from "../test/fakeShopify";
import { forShop, type OrderSnapshot } from "../models/preorder.server";
import { MAX_ATTEMPTS, backoffMs, outboxFor } from "../models/outbox.server";
import { syncVariant } from "../sync/syncVariant.server";
import { processOutbox } from "./outbox.server";
import { buildEvent, EVENT_TYPES, type PreauraEvent } from "./build";
import {
  FLOW_HANDLES,
  KLAVIYO_REVISION,
  SIGNATURE_HEADER,
  toFlowPayload,
  toKlaviyoBody,
  toWebhookBody,
  verifyWebhook,
} from "./channels";

// Det fælles hændelsessystem hele vejen: en ændring lægger en hændelse i
// udbakken, den bygges én gang og sendes ens til Flow, webhook og Klaviyo.

process.env.PREAURA_ENCRYPTION_KEY = "test-nøgle";

const testDb = createTestDb();
const client = testDb.client;
const SHOP = "butik.myshopify.com";
const VARIANT = "gid://shopify/ProductVariant/1";
const TODAY = "2026-11-02";
const WEBHOOK_URL = "https://hooks.example.com/preaura";
const KLAVIYO_KEY = "pk_abcdefghij1234567890";

beforeAll(() => testDb.setup());
afterAll(() => testDb.teardown());
beforeEach(() => testDb.reset());

const data = () => forShop(SHOP, client);
const outbox = () => outboxFor(SHOP, client);

/** En simuleret Klaviyo: afviser dubletter på profil, metric og unique_id. */
function fakeKlaviyo() {
  const events = new Map<string, unknown>();
  let timeoutsLeft = 0;
  return {
    events,
    /** De næste n kald gemmes hos Klaviyo, men svaret når aldrig frem. */
    timeoutAfterAccept(n: number) {
      timeoutsLeft = n;
    },
    handle(body: string) {
      const attrs = JSON.parse(body).data.attributes;
      const key = [
        attrs.profile.data.attributes.email,
        attrs.metric.data.attributes.name,
        attrs.unique_id,
      ].join("|");
      if (!events.has(key)) events.set(key, attrs);
      if (timeoutsLeft > 0) {
        timeoutsLeft -= 1;
        const error = new Error("The operation was aborted due to timeout");
        error.name = "TimeoutError";
        throw error;
      }
      return new Response(null, { status: 202 });
    },
  };
}

type Sent = { url: string; headers: Record<string, string>; body: string };

async function setup({ webhookStatus = 200 }: { webhookStatus?: number } = {}) {
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
  const sync = () =>
    syncVariant({
      shop: SHOP,
      variantId: VARIANT,
      gateway: shopify.gateway,
      client,
    });
  expect((await sync()).ok).toBe(true);
  const planId = (
    await client.delivery.findUniqueOrThrow({ where: { id: delivery.id } })
  ).sellingPlanId!;

  const integrations = outbox().integrations;
  await integrations.acceptResponsibility(true);
  await integrations.setWebhookUrl(WEBHOOK_URL);
  await integrations.setWebhookEnabled(true);
  await integrations.setKlaviyoKey(KLAVIYO_KEY);
  await integrations.setKlaviyoEnabled(true);

  const klaviyo = fakeKlaviyo();
  const sent: { webhook: Sent[]; klaviyo: Sent[] } = {
    webhook: [],
    klaviyo: [],
  };
  const fetchFn = (async (url: string, init: RequestInit) => {
    const request = {
      url,
      headers: init.headers as Record<string, string>,
      body: String(init.body),
    };
    if (url === WEBHOOK_URL) {
      sent.webhook.push(request);
      return new Response("", { status: webhookStatus });
    }
    sent.klaviyo.push(request);
    return klaviyo.handle(request.body);
  }) as unknown as typeof fetch;

  let clock = new Date("2026-11-02T10:00:00Z");
  const h = {
    shopify,
    delivery,
    sent,
    klaviyo,
    sync,
    now: () => clock,
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
    run: () =>
      processOutbox({
        shop: SHOP,
        client,
        now: () => clock,
        deps: {
          readOrderDetails: shopify.gateway.readOrderDetails,
          flowTriggerReceive: shopify.gateway.flowTriggerReceive,
          fetch: fetchFn,
        },
      }),
    async order(
      n: number,
      quantity: number,
      opts: { cancelled?: boolean } = {},
    ) {
      const snapshot: OrderSnapshot = {
        id: `gid://shopify/Order/${n}`,
        name: `#${1000 + n}`,
        createdAt: new Date(Date.now() + n).toISOString(),
        cancelled: opts.cancelled ?? false,
        lines: [
          {
            id: `gid://shopify/LineItem/${n}`,
            variantId: VARIANT,
            sellingPlanId: planId,
            quantity,
          },
        ],
      };
      shopify.putOrder(snapshot);
      await data().orders.apply(snapshot);
      return snapshot;
    },
    events: () =>
      client.outboxEvent.findMany({ orderBy: { createdAt: "asc" } }),
  };
  return h;
}

describe("hændelserne opstår de rigtige steder", () => {
  it("oprettet, når en ordre får plads — og kun én gang", async () => {
    const h = await setup();
    await h.order(1, 2);
    await h.order(1, 2); // samme ordre igen (fx orders/updated)
    const events = await h.events();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "preorder.created",
      orderName: "#1001",
      quantity: 2,
      deliveryDate: "2026-12-01",
      previousDate: null,
    });
  });

  it("annulleret, når ordren annulleres", async () => {
    const h = await setup();
    await h.order(1, 2);
    await h.order(1, 2, { cancelled: true });
    expect((await h.events()).map((e) => e.type)).toEqual([
      "preorder.created",
      "preorder.cancelled",
    ]);
  });

  it("forsinket, når leverancens dato rykkes senere — med den tidligere dato", async () => {
    const h = await setup();
    await h.order(1, 2);
    await data().deliveries.update(
      h.delivery.id,
      { date: "2026-12-15", quantity: "10" },
      TODAY,
    );
    // En tidligere dato er ikke en forsinkelse.
    await data().deliveries.update(
      h.delivery.id,
      { date: "2026-12-10", quantity: "10" },
      TODAY,
    );
    const delayed = (await h.events()).filter(
      (e) => e.type === "preorder.delayed",
    );
    expect(delayed).toHaveLength(1);
    expect(delayed[0]).toMatchObject({
      deliveryDate: "2026-12-15",
      previousDate: "2026-12-01",
    });
  });

  it("klar til afsendelse, når varerne kommer på lager — i bestillingsrækkefølge", async () => {
    const h = await setup();
    await h.order(1, 2);
    await h.order(2, 3);
    await h.sync();
    // 2 stk. kommer hjem: nok til ordre 1, ikke til ordre 2.
    const variant = h.shopify.variants.get(VARIANT)!;
    variant.available = (variant.available ?? 0) + 2;
    await h.sync();
    let ready = (await h.events()).filter((e) => e.type === "preorder.ready");
    expect(ready.map((e) => e.orderName)).toEqual(["#1001"]);

    // 3 mere: nu også ordre 2.
    variant.available = (variant.available ?? 0) + 3;
    await h.sync();
    ready = (await h.events()).filter((e) => e.type === "preorder.ready");
    expect(ready.map((e) => e.orderName)).toEqual(["#1001", "#1002"]);
  });

  it("klar til afsendelse med knappen på leverancen", async () => {
    const h = await setup();
    await h.order(1, 2);
    expect((await data().deliveries.markReady(h.delivery.id)).count).toBe(1);
    expect((await data().deliveries.markReady(h.delivery.id)).count).toBe(0);
    const ready = (await h.events()).filter((e) => e.type === "preorder.ready");
    expect(ready).toHaveLength(1);
  });
});

describe("alle fire hændelser bygges ens uanset modtager", () => {
  const event: PreauraEvent = buildEvent(
    {
      id: "6f1c2a4e-0b2d-4a8e-9c1f-3d5e7a9b1c2d",
      shop: SHOP,
      type: "preorder.created",
      orderId: "gid://shopify/Order/1",
      orderName: "#1001",
      orderLineId: "gid://shopify/LineItem/1",
      variantId: VARIANT,
      quantity: 2,
      deliveryDate: "2026-12-15",
      previousDate: "2026-12-01",
      createdAt: new Date("2026-11-02T10:00:00Z"),
    },
    {
      name: "#1001",
      customer: {
        email: "anna@example.com",
        firstName: "Anna",
        lastName: "Jensen",
      },
      lines: [
        {
          id: "gid://shopify/LineItem/1",
          productId: "gid://shopify/Product/1",
          productTitle: "Oxygen",
          variantTitle: "158 cm",
          sku: "OXY-158",
        },
      ],
    },
  );

  it.each(EVENT_TYPES)(
    "%s: samme indhold i Flow, webhook og Klaviyo",
    (type) => {
      const e = { ...event, type };
      const flow = toFlowPayload(e);
      const webhook = JSON.parse(toWebhookBody(e)) as PreauraEvent;
      const klaviyo = JSON.parse(toKlaviyoBody(e)).data.attributes;

      // Webhooken er hændelsen selv.
      expect(webhook).toEqual(e);
      const fields = {
        id: [flow["Event id"], webhook.id, klaviyo.unique_id],
        order: [
          flow["Order name"],
          webhook.order.name,
          klaviyo.properties.order_name,
        ],
        email: [
          flow["Customer email"],
          webhook.customer.email,
          klaviyo.profile.data.attributes.email,
        ],
        product: [
          flow["Product title"],
          webhook.product.title,
          klaviyo.properties.product_title,
        ],
        variant: [
          flow["Variant title"],
          webhook.variant.title,
          klaviyo.properties.variant_title,
        ],
        quantity: [
          flow.Quantity,
          webhook.quantity,
          klaviyo.properties.quantity,
        ],
        date: [
          flow["Delivery date"],
          webhook.deliveryDate,
          klaviyo.properties.delivery_date,
        ],
        previous: [
          flow["Previous delivery date"],
          webhook.previousDeliveryDate,
          klaviyo.properties.previous_delivery_date,
        ],
      };
      for (const [name, values] of Object.entries(fields)) {
        expect(new Set(values), name).toHaveProperty("size", 1);
      }
      expect(flow.order_id).toBe(1);
      expect(flow["Customer name"]).toBe("Anna Jensen");
      expect(klaviyo.properties.event_type).toBe(type);
      expect(webhook.shop).toBe(SHOP);
    },
  );

  it("hele vejen: Flow, webhook og Klaviyo får den samme hændelse", async () => {
    const h = await setup();
    await h.order(1, 2);
    expect(await h.run()).toMatchObject({ built: 1, sent: 3, failed: 0 });

    const [flow] = h.shopify.flowTriggers;
    const webhook = JSON.parse(h.sent.webhook[0].body) as PreauraEvent;
    const klaviyo = JSON.parse(h.sent.klaviyo[0].body).data.attributes;
    expect(flow.handle).toBe(FLOW_HANDLES["preorder.created"]);
    expect(flow.payload).toEqual(toFlowPayload(webhook));
    expect(h.sent.klaviyo[0].body).toBe(toKlaviyoBody(webhook));
    expect(klaviyo.unique_id).toBe(webhook.id);
    expect(webhook).toMatchObject({
      type: "preorder.created",
      shop: SHOP,
      customer: { email: "kunde@example.com", name: "Anna Jensen" },
      order: { name: "#1001" },
      product: { title: "Oxygen" },
      variant: { title: "158 cm" },
      quantity: 2,
      deliveryDate: "2026-12-01",
      previousDeliveryDate: null,
    });
    // Klaviyos headere.
    expect(h.sent.klaviyo[0].headers).toMatchObject({
      Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
      revision: KLAVIYO_REVISION,
    });
  });
});

describe("webhookens signatur", () => {
  it("kan verificeres med nøglen fra admin — og afslører ændringer", async () => {
    const h = await setup();
    await h.order(1, 2);
    await h.run();
    const [call] = h.sent.webhook;
    const { webhookSecret } = await outbox().integrations.view();
    expect(webhookSecret).toMatch(/^[0-9a-f]{64}$/);
    const signature = call.headers[SIGNATURE_HEADER];
    expect(verifyWebhook(call.body, webhookSecret!, signature)).toBe(true);
    expect(
      verifyWebhook(
        call.body.replace("#1001", "#9999"),
        webhookSecret!,
        signature,
      ),
    ).toBe(false);
    expect(verifyWebhook(call.body, "forkert-nøgle", signature)).toBe(false);
  });
});

describe("Klaviyo og genforsøg", () => {
  it("et genforsøg efter en timeout sender samme unique_id — ingen dublet hos Klaviyo", async () => {
    const h = await setup();
    h.klaviyo.timeoutAfterAccept(1);
    await h.order(1, 2);
    await h.run();
    const [delivery] = await client.outboxDelivery.findMany({
      where: { channel: "KLAVIYO" },
    });
    expect(delivery).toMatchObject({ status: "PENDING", attempts: 1 });

    h.advance(backoffMs(1));
    await h.run();
    expect(h.sent.klaviyo).toHaveLength(2);
    const ids = h.sent.klaviyo.map(
      (c) => JSON.parse(c.body).data.attributes.unique_id,
    );
    expect(new Set(ids).size).toBe(1);
    expect(h.klaviyo.events.size).toBe(1);
    expect(
      await client.outboxDelivery.findFirst({ where: { channel: "KLAVIYO" } }),
    ).toMatchObject({ status: "DONE", attempts: 2 });
  });

  it("uden kundens e-mail fejler Klaviyo med en forklaring — de andre modtagere får hændelsen", async () => {
    const h = await setup();
    h.shopify.customers.set("gid://shopify/Order/1", null);
    await h.order(1, 2);
    await h.run();
    const failed = await outbox().deliveries.failed();
    expect(failed.map((d) => d.channel)).toEqual(["KLAVIYO"]);
    expect(failed[0].lastError).toContain("e-mail");
    expect(h.shopify.flowTriggers).toHaveLength(1);
    expect(h.sent.webhook).toHaveLength(1);
  });
});

describe("fejlede leveringer", () => {
  it("prøves igen med voksende ventetid og havner til sidst på fejllisten", async () => {
    const h = await setup({ webhookStatus: 503 });
    await h.order(1, 2);
    await h.run();
    // Før ventetiden er gået, prøves der ikke igen.
    await h.run();
    expect(h.sent.webhook).toHaveLength(1);

    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      h.advance(backoffMs(attempt));
      await h.run();
    }
    expect(h.sent.webhook).toHaveLength(MAX_ATTEMPTS);
    const failed = await outbox().deliveries.failed();
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      channel: "WEBHOOK",
      status: "FAILED",
      attempts: MAX_ATTEMPTS,
      lastStatus: 503,
    });
    expect(failed[0].lastError).toContain("503");

    // Prøv igen fra admin: sendes straks, hændelsen er ikke tabt.
    expect(await outbox().deliveries.retry(failed[0].id, h.now())).toBe(1);
    await h.run();
    expect(h.sent.webhook).toHaveLength(MAX_ATTEMPTS + 1);
    const body = JSON.parse(h.sent.webhook.at(-1)!.body);
    expect(body.order.name).toBe("#1001");
  });

  it("et svar, der ikke bliver bedre (fx 401), fejler med det samme", async () => {
    const h = await setup({ webhookStatus: 401 });
    await h.order(1, 2);
    await h.run();
    expect(await outbox().deliveries.failed()).toHaveLength(1);
  });
});

describe("hemmeligheder", () => {
  it("gemmes krypteret og vises kun som de sidste fire tegn", async () => {
    await setup();
    const row = await client.integrationSetting.findFirstOrThrow();
    expect(row.webhookUrlEnc).not.toContain("example.com");
    expect(row.klaviyoKeyEnc).not.toContain("pk_");
    const view = await outbox().integrations.view();
    expect(view).toMatchObject({
      webhookUrlLast4: WEBHOOK_URL.slice(-4),
      klaviyoKeyLast4: KLAVIYO_KEY.slice(-4),
    });
    expect(JSON.stringify(view)).not.toContain(KLAVIYO_KEY);
    expect(JSON.stringify(view)).not.toContain(WEBHOOK_URL);
  });

  it("kundens navn og e-mail gemmes krypteret i hændelsen", async () => {
    const h = await setup();
    await h.order(1, 2);
    await h.run();
    const [event] = await h.events();
    expect(event.payloadEnc).not.toBeNull();
    expect(event.payloadEnc).not.toContain("kunde@example.com");
  });

  it("uden bekræftet ansvar sendes intet til webhook og Klaviyo — kun Flow", async () => {
    const h = await setup();
    await outbox().integrations.acceptResponsibility(false);
    await h.order(1, 2);
    await h.run();
    expect(h.sent.webhook).toHaveLength(0);
    expect(h.sent.klaviyo).toHaveLength(0);
    expect(h.shopify.flowTriggers).toHaveLength(1);
  });
});
