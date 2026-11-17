import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

// Opgave 17: forsøg på at bryde adskillelsen mellem butikker.
//
// Appen er installeret i to butikker på samme tid. Med butik B's login kaldes
// appens rigtige sider (loader og action) med butik A's id'er: leverance,
// tildeling, venteliste, annullering, afvist betaling, hændelser, kø og
// dataanmodning. Testen går kun grøn, hvis hvert forsøg afvises, intet fra A
// kan ses hos B, og A's data er nøjagtig som før, bagefter.

const holder = vi.hoisted(() => ({
  client: null as unknown as PrismaClient,
  shop: "",
}));

vi.mock("../db.server", () => ({
  default: new Proxy({}, { get: (_t, key) => Reflect.get(holder.client, key) }),
}));

/** Shopify svarer tomt: B's Shopify kender ikke A's ordrer og varer. */
const graphql = async () =>
  new Response(
    JSON.stringify({
      data: {
        shop: { ianaTimezone: "Europe/Copenhagen" },
        nodes: [],
        products: { nodes: [] },
        product: null,
        order: null,
      },
    }),
  );

vi.mock("../shopify.server", () => {
  const context = () => ({
    session: { shop: holder.shop, id: `offline_${holder.shop}` },
    admin: { graphql },
  });
  return {
    authenticate: {
      admin: async () => context(),
      public: {
        appProxy: async () => ({
          ...context(),
          liquid: (body: string) => new Response(body),
        }),
      },
    },
    unauthenticated: { admin: async () => context() },
  };
});
vi.mock("../billing/requireSubscription.server", () => ({
  requireSubscription: async () => ({
    session: { shop: holder.shop },
    admin: { graphql },
  }),
}));
vi.mock("../billing/access.server", () => ({
  accessFor: async () => ({ status: "active" }),
}));
vi.mock("../orders/scheduler.server", () => ({ scheduleQueue: () => {} }));

process.env.PREAURA_ENCRYPTION_KEY = "test-nøgle";
process.env.SHOPIFY_API_SECRET = "test-hemmelighed";

const { createTestDb } = await import("../test/testDb");
const { forShop } = await import("../models/preorder.server");
const { waitlistFor } = await import("../models/waitlist.server");
const { cancelLink } = await import("../release/link.server");
const deliveryRoute = await import("../routes/app.deliveries.$deliveryId");
const productRoute = await import("../routes/app.products.$productId");
const queueRoute = await import("../routes/app.queue");
const releasesRoute = await import("../routes/app.releases");
const eventsRoute = await import("../routes/app.events");
const waitlistRoute = await import("../routes/app.waitlist");
const cancelRoute = await import("../routes/proxy.cancel");

const testDb = createTestDb();
holder.client = testDb.client;
const client = testDb.client;

const A = "butik-a.myshopify.com";
const B = "butik-b.myshopify.com";
const A_VARIANT = "gid://shopify/ProductVariant/111";
const B_VARIANT = "gid://shopify/ProductVariant/222";
const A_ORDER = "gid://shopify/Order/9001";
const A_EMAIL = "a-kunde@example.com";
const A_DATE = "2031-03-03";

beforeAll(() => testDb.setup());
afterAll(() => testDb.teardown());

/** Alt i databasen, der tilhører en butik. */
const SHOP_TABLES = [
  "session",
  "shopSetting",
  "integrationSetting",
  "variantPlan",
  "modeChange",
  "delivery",
  "sellingPlanRef",
  "allocation",
  "outboxEvent",
  "outboxDelivery",
  "waitlistEntry",
  "waitlistWatch",
  "waitlistStat",
  "cancellationRequest",
  "paymentIssue",
  "webhookEvent",
  "dataRequest",
  "accessLog",
] as const;
async function everything(shop: string) {
  const out: Record<string, unknown[]> = {};
  for (const name of SHOP_TABLES) {
    out[name] = await (
      client as unknown as Record<
        string,
        { findMany(a: unknown): Promise<unknown[]> }
      >
    )[name]
      .findMany({ where: { shop }, orderBy: { id: "asc" } })
      .catch(() =>
        // Tabeller uden kolonnen id (fx WaitlistWatch) sorteres ikke.
        (
          client as unknown as Record<
            string,
            { findMany(a: unknown): Promise<unknown[]> }
          >
        )[name].findMany({ where: { shop } }),
      );
  }
  return out;
}

async function install(shop: string, variantId: string, date: string) {
  await client.session.create({
    data: { id: `offline_${shop}`, shop, state: "ok", accessToken: "t" },
  });
  const data = forShop(shop, client);
  await data.variantPlans.addVariants([
    {
      productId: "gid://shopify/Product/1",
      variantId,
      inventoryItemId: "gid://shopify/InventoryItem/1",
      locationId: "gid://shopify/Location/1",
    },
  ]);
  return data.deliveries.create(
    variantId,
    { date, quantity: "10" },
    "2026-11-02",
  );
}

function form(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request("https://app.test/app", { method: "POST", body });
}
const get = (url = "https://app.test/app") => new Request(url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Args = any;

describe("butik B forsøger at nå butik A's data", () => {
  it("hvert forsøg afvises, intet fra A ses hos B, og A er uændret", async () => {
    // --- Butik A: leverance, tildeling, venteliste, annullering, afvist
    // betaling, fejlet hændelse, fejlet kø-hændelse og dataanmodning.
    const aDelivery = await install(A, A_VARIANT, A_DATE);
    await install(B, B_VARIANT, "2031-04-04");
    const allocation = await client.allocation.create({
      data: {
        shop: A,
        orderId: A_ORDER,
        orderName: "#A1",
        orderLineId: "gid://shopify/LineItem/9001",
        variantId: A_VARIANT,
        deliveryId: aDelivery.id,
        quantity: 2,
        promisedDate: A_DATE,
      },
    });
    await waitlistFor(A, client).add({
      productId: "gid://shopify/Product/1",
      variantId: A_VARIANT,
      email: A_EMAIL,
    });
    const cancellation = await client.cancellationRequest.create({
      data: { shop: A, orderId: A_ORDER, orderName: "#A1", lines: "[]" },
    });
    const issue = await client.paymentIssue.create({
      data: {
        shop: A,
        orderId: A_ORDER,
        orderName: "#A1",
        failedAt: new Date(),
        releaseAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    const outboxEvent = await client.outboxEvent.create({
      data: {
        id: "a-outbox-event",
        shop: A,
        type: "preorder.created",
        dedupeKey: "a-1",
        orderId: A_ORDER,
        orderName: "#A1",
        variantId: A_VARIANT,
        quantity: 2,
      },
    });
    const outboxDelivery = await client.outboxDelivery.create({
      data: {
        shop: A,
        eventId: outboxEvent.id,
        channel: "WEBHOOK",
        status: "FAILED",
        lastError: "fejl",
      },
    });
    const failedEvent = await client.webhookEvent.create({
      data: {
        webhookId: "a-webhook",
        shop: A,
        topic: "ORDERS_CREATE",
        payload: JSON.stringify({ admin_graphql_api_id: A_ORDER }),
        status: "FAILED",
      },
    });
    const dataRequest = await client.dataRequest.create({
      data: {
        shop: A,
        customerId: "77",
        orderIds: JSON.stringify([A_ORDER]),
        data: "[]",
      },
    });

    const before = await everything(A);
    const aMarkers = [
      aDelivery.id,
      allocation.id,
      A_ORDER,
      A_VARIANT,
      A_EMAIL,
      A_DATE,
      cancellation.id,
      issue.id,
      outboxEvent.id,
      outboxDelivery.id,
      failedEvent.id,
      dataRequest.id,
    ];
    const leaks = (value: unknown) => {
      const text = JSON.stringify(value) ?? "";
      return aMarkers.filter((m) => text.includes(m));
    };

    // --- Herfra er alle kald logget ind som butik B.
    holder.shop = B;
    const results: Record<string, unknown> = {};
    const attempt = async (name: string, fn: () => Promise<unknown>) => {
      try {
        results[name] = await fn();
      } catch (error) {
        // En afvisning som 404-svar er også et nej.
        results[name] =
          error instanceof Response
            ? { status: error.status }
            : { error: String(error) };
      }
    };

    // Leverancen og dens tildelinger.
    await attempt("leverance: vis", () =>
      deliveryRoute.loader({
        request: get(),
        params: { deliveryId: aDelivery.id },
      } as Args),
    );
    expect(results["leverance: vis"]).toEqual({ status: 404 });
    await attempt("leverance: marker klar", () =>
      deliveryRoute.action({
        request: form({ intent: "ready" }),
        params: { deliveryId: aDelivery.id },
      } as Args),
    );
    for (const intent of ["update", "delete", "cancel"]) {
      await attempt(`produkt: ${intent} leverance`, () =>
        productRoute.action({
          request: form({
            intent,
            deliveryId: aDelivery.id,
            date: "2031-05-05",
            quantity: "1",
          }),
          params: { productId: "1" },
        } as Args),
      );
      expect(results[`produkt: ${intent} leverance`]).toMatchObject({
        ok: false,
      });
    }
    for (const intent of ["toggle", "force", "sync", "create"]) {
      await attempt(`produkt: ${intent} variant`, () =>
        productRoute.action({
          request: form({
            intent,
            variantId: A_VARIANT,
            enabled: "false",
            forced: "true",
            date: "2031-06-06",
            quantity: "1",
          }),
          params: { productId: "1" },
        } as Args),
      );
      expect(results[`produkt: ${intent} variant`]).toMatchObject({
        ok: false,
      });
    }

    // Annullering og afvist betaling.
    for (const intent of ["approve", "reject", "retry"]) {
      await attempt(`annullering: ${intent}`, () =>
        releasesRoute.action({
          request: form({ intent, id: cancellation.id }),
          params: {},
        } as Args),
      );
    }
    for (const intent of ["release", "extend"]) {
      await attempt(`afvist betaling: ${intent}`, () =>
        releasesRoute.action({
          request: form({ intent, id: issue.id }),
          params: {},
        } as Args),
      );
    }
    for (const name of [
      "annullering: approve",
      "annullering: reject",
      "annullering: retry",
      "afvist betaling: release",
      "afvist betaling: extend",
    ]) {
      expect({ name, result: results[name] }).toMatchObject({
        name,
        result: { ok: false },
      });
    }

    // Kø, dataanmodning og udgående hændelser.
    await attempt("kø: prøv igen", () =>
      queueRoute.action({
        request: form({ intent: "retry", eventId: failedEvent.id }),
        params: {},
      } as Args),
    );
    await attempt("dataanmodning: besvar", () =>
      queueRoute.action({
        request: form({ intent: "answer", requestId: dataRequest.id }),
        params: {},
      } as Args),
    );
    expect(results["dataanmodning: besvar"]).toMatchObject({ ok: false });
    await attempt("hændelse: prøv igen", () =>
      eventsRoute.action({
        request: form({ intent: "retry", deliveryId: outboxDelivery.id }),
        params: {},
      } as Args),
    );

    // Kundens annulleringslink til A's ordre, åbnet i B's butik.
    const link = new URL(
      cancelLink(A, A_ORDER, new Date(), {
        cancelWindow: "DAYS",
        cancelDays: 14,
      }),
    );
    const linkParams = Object.fromEntries(link.searchParams);
    await attempt("annulleringslink: vis", async () => {
      const response = await cancelRoute.loader({
        request: get(`https://${B}/apps/preaura/cancel${link.search}`),
        params: linkParams,
      } as Args);
      return { status: response.status, body: await response.text() };
    });
    await attempt("annulleringslink: send", async () => {
      const body = new FormData();
      body.set("q_9001", "0");
      const response = await cancelRoute.action({
        request: new Request(`https://${B}/apps/preaura/cancel${link.search}`, {
          method: "POST",
          body,
        }),
        params: linkParams,
      } as Args);
      return { status: response.status, body: await response.text() };
    });

    for (const name of ["annulleringslink: vis", "annulleringslink: send"]) {
      expect((results[name] as { body: string }).body).toContain(
        "Linket er ugyldigt eller udløbet",
      );
    }
    expect(await client.cancellationRequest.count({ where: { shop: B } })).toBe(
      0,
    );

    // B's egne sider viser intet fra A.
    for (const [name, route] of [
      ["kø", queueRoute],
      ["annulleringer", releasesRoute],
      ["hændelser", eventsRoute],
      ["venteliste", waitlistRoute],
    ] as const) {
      await attempt(`side: ${name}`, () =>
        (route as { loader: (a: Args) => Promise<unknown> }).loader({
          request: get(),
          params: {},
        }),
      );
    }

    // --- Dommen.
    for (const [name, value] of Object.entries(results)) {
      expect({ name, leaks: leaks(value) }).toEqual({ name, leaks: [] });
    }
    expect(await everything(A)).toEqual(before);
  });
});
