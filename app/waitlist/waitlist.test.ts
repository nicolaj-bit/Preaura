import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../test/testDb";
import { forShop } from "../models/preorder.server";
import { outboxFor } from "../models/outbox.server";
import {
  NOTIFIED_RETENTION_DAYS,
  OPEN_RETENTION_DAYS,
  purgeWaitlist,
  waitlistFor,
} from "../models/waitlist.server";
import { complianceFor, purgeOldData } from "../models/compliance.server";
import { hashEmail } from "../lib/crypto.server";
import { processOutbox } from "../events/outbox.server";
import { buildWaitlistEvent } from "../events/build";
import { toKlaviyoBody, toWebhookBody } from "../events/channels";
import {
  processWaitlist,
  type VariantAvailability,
  type WaitlistDeps,
} from "./process.server";
import {
  createRateLimiter,
  handleSignup,
  senderKey,
  variantGid,
} from "./signup.server";
import { parseWaitlistSettings, waitlistRows } from "./view";

// Ventelisten hele vejen: tilmelding → varen kan købes (stabilt) → portioner
// i tilmeldingsrækkefølge → én hændelse pr. tilmelding i udbakken → sendt
// som hændelse. Og sletning og indsigt efter GDPR.

process.env.PREAURA_ENCRYPTION_KEY = "test-nøgle";

const testDb = createTestDb();
const client = testDb.client;
const SHOP = "butik.myshopify.com";
const PRODUCT = "gid://shopify/Product/1";
const VARIANT = "gid://shopify/ProductVariant/1";
const OTHER = "gid://shopify/ProductVariant/2";
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

beforeAll(() => testDb.setup());
afterAll(() => testDb.teardown());
beforeEach(() => testDb.reset());

const waitlist = () => waitlistFor(SHOP, client);

/** En butik med Flow slået til (standard) og en verden, vi styrer. */
function world() {
  let clock = new Date("2026-11-06T10:00:00Z");
  const availability = new Map<string, VariantAvailability>();
  let access = true;
  const deps: WaitlistDeps = {
    hasAccess: async () => access,
    readAvailability: async (ids) =>
      new Map(
        ids
          .filter((id) => availability.has(id))
          .map((id) => [id, availability.get(id)!]),
      ),
  };
  return {
    now: () => clock,
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
    set(variantId: string, available: boolean, quantity: number | null = 5) {
      availability.set(variantId, { available, quantity });
    },
    setAccess(value: boolean) {
      access = value;
    },
    run: () => processWaitlist({ shop: SHOP, deps, client, now: () => clock }),
    async signUp(emails: string[], variantId = VARIANT) {
      for (const email of emails) {
        await waitlist().add({ productId: PRODUCT, variantId, email });
        // Rækkefølgen afgøres af tidspunktet.
        clock = new Date(clock.getTime() + 1000);
      }
    },
    events: () =>
      client.outboxEvent.findMany({
        where: { type: "waitlist.available" },
        orderBy: { createdAt: "asc" },
      }),
  };
}

async function emailsOf(events: { waitlistEntryId: string | null }[]) {
  const result: (string | null)[] = [];
  for (const e of events) {
    result.push(await waitlist().emailFor(e.waitlistEntryId!));
  }
  return result;
}

describe("tilmelding", () => {
  it("gemmer kun e-mail (krypteret), produkt, variant, butik og tidspunkt", async () => {
    await waitlist().add({
      productId: PRODUCT,
      variantId: VARIANT,
      email: " Anna@Example.com ",
    });
    const [row] = await client.waitlistEntry.findMany();
    expect(Object.keys(row).sort()).toEqual(
      [
        "createdAt",
        "emailEnc",
        "emailHash",
        "id",
        "notifiedAt",
        "productId",
        "shop",
        "variantId",
      ].sort(),
    );
    expect(row.emailEnc).not.toContain("anna");
    expect(row.emailHash).toBe(hashEmail("anna@example.com"));
    expect(await waitlist().emailFor(row.id)).toBe("anna@example.com");
  });

  it("samme e-mail på samme variant står der kun én gang", async () => {
    for (const email of ["anna@example.com", "ANNA@example.com "]) {
      await waitlist().add({ productId: PRODUCT, variantId: VARIANT, email });
    }
    await waitlist().add({
      productId: PRODUCT,
      variantId: OTHER,
      email: "anna@example.com",
    });
    expect(await client.waitlistEntry.count()).toBe(2);
  });
});

describe("udløsning", () => {
  it("udløser ikke på et glimt: varen skal kunne købes i hele ventetiden", async () => {
    const w = world();
    await w.signUp(["a@example.com"]);
    w.set(VARIANT, true);
    await w.run(); // uret starter
    w.advance(9 * MIN);
    await w.run();
    expect(await w.events()).toHaveLength(0);

    // Et glimt: væk igen — uret starter forfra.
    w.set(VARIANT, false);
    await w.run();
    w.set(VARIANT, true);
    await w.run();
    w.advance(9 * MIN);
    await w.run();
    expect(await w.events()).toHaveLength(0);

    w.advance(1 * MIN);
    await w.run();
    expect(await w.events()).toHaveLength(1);
  });

  it("0 → 5 → 0 → 5: kunden får én besked, ikke to", async () => {
    const w = world();
    await w.signUp(["a@example.com"]);
    w.set(VARIANT, true);
    await w.run();
    w.advance(10 * MIN);
    await w.run();
    w.set(VARIANT, false);
    await w.run();
    w.set(VARIANT, true);
    await w.run();
    w.advance(60 * MIN);
    await w.run();
    w.advance(60 * MIN);
    await w.run();
    expect(await w.events()).toHaveLength(1);
    const [entry] = await client.waitlistEntry.findMany();
    expect(entry.notifiedAt).not.toBeNull();
  });

  it("i tilmeldingsrækkefølge og i portioner med interval", async () => {
    const w = world();
    await waitlist().updateSettings({
      stableMinutes: 10,
      batchSize: 2,
      batchMinutes: 30,
    });
    const emails = ["1@x.dk", "2@x.dk", "3@x.dk", "4@x.dk", "5@x.dk"];
    await w.signUp(emails);
    w.set(VARIANT, true);
    await w.run();
    w.advance(10 * MIN);
    await w.run();
    expect(await emailsOf(await w.events())).toEqual(["1@x.dk", "2@x.dk"]);

    w.advance(29 * MIN);
    await w.run();
    expect(await w.events()).toHaveLength(2);

    w.advance(1 * MIN);
    await w.run();
    expect(await emailsOf(await w.events())).toEqual([
      "1@x.dk",
      "2@x.dk",
      "3@x.dk",
      "4@x.dk",
    ]);
  });

  it("udsolgt midt i udsendelsen: resten venter, til varen kan købes igen", async () => {
    const w = world();
    await waitlist().updateSettings({
      stableMinutes: 10,
      batchSize: 1,
      batchMinutes: 5,
    });
    await w.signUp(["1@x.dk", "2@x.dk"]);
    w.set(VARIANT, true);
    await w.run();
    w.advance(10 * MIN);
    await w.run();
    w.set(VARIANT, false);
    w.advance(5 * MIN);
    await w.run();
    expect(await w.events()).toHaveLength(1);
    expect(
      await client.waitlistEntry.count({ where: { notifiedAt: null } }),
    ).toBe(1);
  });

  it("varen på lager: hændelsen siger «stock» og bærer antal og produkt", async () => {
    const w = world();
    await w.signUp(["a@example.com"]);
    w.set(VARIANT, true, 7);
    await w.run();
    w.advance(10 * MIN);
    await w.run();
    const [event] = await w.events();
    expect(event).toMatchObject({
      variantId: VARIANT,
      productId: PRODUCT,
      deliveryId: null,
      quantity: 7,
      orderId: null,
      emailHash: hashEmail("a@example.com"),
    });
  });

  it("ny leverance med ledige pladser: hændelsen bærer leverancen", async () => {
    const w = world();
    const data = forShop(SHOP, client);
    await data.variantPlans.addVariants([
      {
        productId: PRODUCT,
        variantId: VARIANT,
        inventoryItemId: "gid://shopify/InventoryItem/1",
        locationId: "gid://shopify/Location/1",
      },
    ]);
    await data.variantPlans.setEnabled(VARIANT, true);
    await client.variantPlan.updateMany({ data: { mode: "PREORDER" } });
    const delivery = await data.deliveries.create(
      VARIANT,
      { date: "2026-12-01", quantity: "12" },
      "2026-11-06",
    );
    await w.signUp(["a@example.com"]);
    w.set(VARIANT, true, 12);
    await w.run();
    w.advance(10 * MIN);
    await w.run();
    const [event] = await w.events();
    expect(event).toMatchObject({
      deliveryId: delivery.id,
      deliveryDate: "2026-12-01",
      quantity: 12,
    });
    const overview = await waitlist().overview();
    expect(overview.notified).toEqual([
      expect.objectContaining({
        variantId: VARIANT,
        deliveryId: delivery.id,
        deliveryDate: "2026-12-01",
        count: 1,
      }),
    ]);
  });

  it("uden abonnement eller uden modtagere udløses intet — og intet slettes", async () => {
    const w = world();
    await w.signUp(["a@example.com"]);
    w.set(VARIANT, true);
    w.setAccess(false);
    expect(await w.run()).toEqual({ ran: false, reason: "no-access" });

    w.setAccess(true);
    await outboxFor(SHOP, client).integrations.setFlow(false);
    expect(await w.run()).toEqual({ ran: false, reason: "no-recipients" });
    expect(await w.events()).toHaveLength(0);
    expect(
      await client.waitlistEntry.count({ where: { notifiedAt: null } }),
    ).toBe(1);
  });

  it("varianter er uafhængige, og admin ser antal ventende pr. variant", async () => {
    const w = world();
    await w.signUp(["a@x.dk", "b@x.dk"], VARIANT);
    await w.signUp(["c@x.dk"], OTHER);
    const overview = await waitlist().overview();
    const counts = Object.fromEntries(
      overview.waiting.map((r) => [r.variantId, r.count]),
    );
    expect(counts).toEqual({ [VARIANT]: 2, [OTHER]: 1 });
  });
});

describe("beskeden sendes gennem det fælles hændelsessystem", () => {
  it("bygges med kundens e-mail, produkt, variant og leverance og sendes til Flow", async () => {
    const w = world();
    await w.signUp(["a@example.com"]);
    w.set(VARIANT, true, 3);
    await w.run();
    w.advance(10 * MIN);
    await w.run();

    const flows: { handle: string; payload: Record<string, unknown> }[] = [];
    await processOutbox({
      shop: SHOP,
      client,
      now: w.now,
      deps: {
        readOrderDetails: async () => null,
        readVariantDetails: async () => ({
          productId: PRODUCT,
          productTitle: "Kjole",
          variantTitle: "Blå / M",
          sku: "K-1",
        }),
        flowTriggerReceive: async (handle, payload) => {
          flows.push({ handle, payload });
        },
        fetch: (async () => new Response(null)) as unknown as typeof fetch,
      },
    });
    expect(flows).toEqual([
      {
        handle: "preaura-waitlist-available",
        payload: expect.objectContaining({
          product_id: 1,
          "Customer email": "a@example.com",
          "Product title": "Kjole",
          "Variant title": "Blå / M",
          Availability: "stock",
          "Available quantity": 3,
          "Delivery id": "",
        }),
      },
    ]);
  });

  it("Klaviyo og webhook får produkt, variant, leverance og e-mail — ingen ordre", () => {
    const event = buildWaitlistEvent(
      {
        id: "e1",
        shop: SHOP,
        type: "waitlist.available",
        orderId: null,
        orderName: "",
        orderLineId: null,
        variantId: VARIANT,
        productId: PRODUCT,
        deliveryId: "d1",
        quantity: 12,
        deliveryDate: "2026-12-01",
        previousDate: null,
        createdAt: new Date("2026-11-06T10:00:00Z"),
      },
      "a@example.com",
      {
        productId: PRODUCT,
        productTitle: "Kjole",
        variantTitle: "M",
        sku: null,
      },
    );
    const klaviyo = JSON.parse(toKlaviyoBody(event)).data.attributes;
    expect(klaviyo.profile.data.attributes.email).toBe("a@example.com");
    expect(klaviyo.metric.data.attributes.name).toBe(
      "PREAURA: Venteliste: varen kan købes",
    );
    expect(klaviyo.properties).toMatchObject({
      product_id: PRODUCT,
      variant_id: VARIANT,
      delivery_id: "d1",
      delivery_date: "2026-12-01",
      availability: "preorder",
      order_id: null,
      quantity: 12,
    });
    const webhook = JSON.parse(toWebhookBody(event));
    expect(webhook).toMatchObject({
      type: "waitlist.available",
      order: null,
      deliveryId: "d1",
      availability: "preorder",
    });
  });

  it("er tilmeldingen slettet, før beskeden blev bygget, fejler hændelsen uden genforsøg", async () => {
    const w = world();
    await w.signUp(["a@example.com"]);
    w.set(VARIANT, true);
    await w.run();
    w.advance(10 * MIN);
    await w.run();
    await client.waitlistEntry.deleteMany();
    await processOutbox({
      shop: SHOP,
      client,
      deps: {
        readOrderDetails: async () => null,
        readVariantDetails: async () => null,
        flowTriggerReceive: async () => {},
        fetch: (async () => new Response(null)) as unknown as typeof fetch,
      },
    });
    const [event] = await w.events();
    expect(event.status).toBe("FAILED");
  });
});

describe("opbevaring og GDPR", () => {
  it("åbne slettes efter 180 dage, udløste 7 dage efter udløsning", async () => {
    const now = new Date("2026-11-06T10:00:00Z");
    await client.waitlistEntry.createMany({
      data: [
        {
          shop: SHOP,
          productId: PRODUCT,
          variantId: VARIANT,
          emailEnc: "x",
          emailHash: "gammel-åben",
          createdAt: new Date(now.getTime() - (OPEN_RETENTION_DAYS + 1) * DAY),
        },
        {
          shop: SHOP,
          productId: PRODUCT,
          variantId: VARIANT,
          emailEnc: "x",
          emailHash: "ny-åben",
          createdAt: new Date(now.getTime() - 10 * DAY),
        },
        {
          shop: SHOP,
          productId: PRODUCT,
          variantId: VARIANT,
          emailEnc: "x",
          emailHash: "gammel-udløst",
          createdAt: new Date(now.getTime() - 20 * DAY),
          notifiedAt: new Date(
            now.getTime() - (NOTIFIED_RETENTION_DAYS + 1) * DAY,
          ),
        },
        {
          shop: SHOP,
          productId: PRODUCT,
          variantId: VARIANT,
          emailEnc: "x",
          emailHash: "ny-udløst",
          createdAt: new Date(now.getTime() - 20 * DAY),
          notifiedAt: new Date(now.getTime() - 2 * DAY),
        },
      ],
    });
    expect(await purgeWaitlist(client, now)).toEqual({ open: 1, notified: 1 });
    const left = await client.waitlistEntry.findMany();
    expect(left.map((r) => r.emailHash).sort()).toEqual([
      "ny-udløst",
      "ny-åben",
    ]);
    // Den fælles oprydning tager ventelisten med.
    expect(await purgeOldData(client, now)).toMatchObject({
      waitlistOpen: 0,
      waitlistNotified: 0,
    });
  });

  it("kundens sletning fjerner tilmeldinger og e-mailen i byggede hændelser", async () => {
    const w = world();
    await w.signUp(["a@example.com", "b@example.com"]);
    w.set(VARIANT, true);
    await w.run();
    w.advance(10 * MIN);
    await w.run();
    await client.outboxEvent.updateMany({ data: { payloadEnc: "krypteret" } });

    const emailHash = hashEmail("A@example.com");
    expect(
      await complianceFor(SHOP, client).waitlistForEmailHash(emailHash),
    ).toEqual([
      expect.objectContaining({ productId: PRODUCT, variantId: VARIANT }),
    ]);
    await complianceFor(SHOP, client).redactCustomer({
      customerId: "1",
      orderIds: [],
      emailHash,
    });
    const entries = await client.waitlistEntry.findMany();
    expect(entries.map((e) => e.emailHash)).toEqual([
      hashEmail("b@example.com"),
    ]);
    const events = await w.events();
    expect(
      events.filter((e) => e.payloadEnc != null).map((e) => e.emailHash),
    ).toEqual([hashEmail("b@example.com")]);
  });

  it("butikkens sletning fjerner alt om ventelisten", async () => {
    const w = world();
    await w.signUp(["a@example.com"]);
    w.set(VARIANT, true);
    await w.run();
    await complianceFor(SHOP, client).redactShop();
    expect(await client.waitlistEntry.count()).toBe(0);
    expect(await client.waitlistWatch.count()).toBe(0);
    expect(await client.waitlistStat.count()).toBe(0);
  });
});

describe("tilmelding fra produktsiden", () => {
  const deps = () => {
    const added: string[] = [];
    return {
      added,
      deps: {
        hasAccess: async () => true,
        productOf: async (id: string) => (id === VARIANT ? PRODUCT : null),
        add: async (input: { email: string }) => {
          added.push(input.email);
        },
      },
    };
  };
  const limits = () => ({
    sender: createRateLimiter([{ limit: 3, windowMs: 15 * MIN }]),
    shop: createRateLimiter([{ limit: 100, windowMs: 60 * MIN }]),
  });

  it("samme svar, uanset om e-mailen står på listen i forvejen", async () => {
    const d = deps();
    const l = limits();
    const first = await handleSignup(
      SHOP,
      "afsender",
      { email: "a@example.com", variantId: "1", trap: "" },
      d.deps,
      l,
    );
    const again = await handleSignup(
      SHOP,
      "afsender",
      { email: "a@example.com", variantId: "1", trap: "" },
      d.deps,
      l,
    );
    expect(again).toEqual(first);
    expect(first).toEqual({ status: 200, body: { ok: true } });
  });

  it("begrænser antal tilmeldinger pr. afsender", async () => {
    const d = deps();
    const l = limits();
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      statuses.push(
        (
          await handleSignup(
            SHOP,
            "afsender",
            { email: `${i}@example.com`, variantId: "1", trap: "" },
            d.deps,
            l,
          )
        ).status,
      );
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
    // En anden afsender rammes ikke.
    expect(
      (
        await handleSignup(
          SHOP,
          "en-anden",
          { email: "x@example.com", variantId: "1", trap: "" },
          d.deps,
          l,
        )
      ).status,
    ).toBe(200);
  });

  it("det skjulte felt: svarer «tak», men gemmer intet", async () => {
    const d = deps();
    const result = await handleSignup(
      SHOP,
      "robot",
      { email: "a@example.com", variantId: "1", trap: "https://spam" },
      d.deps,
      limits(),
    );
    expect(result.status).toBe(200);
    expect(d.added).toEqual([]);
  });

  it("afviser ugyldig e-mail, ukendt variant og butik uden abonnement", async () => {
    const d = deps();
    const call = (input: { email: string; variantId: string }) =>
      handleSignup(SHOP, "s", { ...input, trap: "" }, d.deps, limits());
    expect(
      (await call({ email: "ikke-en-mail", variantId: "1" })).body,
    ).toEqual({ ok: false, error: "invalid_email" });
    expect(
      (await call({ email: "a@example.com", variantId: "99" })).body,
    ).toEqual({ ok: false, error: "invalid_variant" });
    const noAccess = await handleSignup(
      SHOP,
      "s",
      { email: "a@example.com", variantId: "1", trap: "" },
      { ...d.deps, hasAccess: async () => false },
      limits(),
    );
    expect(noAccess.status).toBe(403);
    expect(d.added).toEqual([]);
  });

  it("afsenderen gemmes kun som en envejs-nøgle pr. butik", () => {
    const key = senderKey(SHOP, "203.0.113.7, 10.0.0.1");
    expect(key).not.toContain("203.0.113.7");
    expect(key).toBe(senderKey(SHOP, "203.0.113.7"));
    expect(key).not.toBe(senderKey("anden.myshopify.com", "203.0.113.7"));
    expect(variantGid("42")).toBe("gid://shopify/ProductVariant/42");
    expect(variantGid("gid://shopify/Product/42")).toBeNull();
  });
});

describe("siden Venteliste", () => {
  it("kontrollerer indstillingerne", () => {
    expect(
      parseWaitlistSettings({
        stableMinutes: "10",
        batchSize: "50",
        batchMinutes: "30",
      }),
    ).toEqual({
      ok: true,
      values: { stableMinutes: 10, batchSize: 50, batchMinutes: 30 },
    });
    const bad = parseWaitlistSettings({
      stableMinutes: "0",
      batchSize: "abc",
      batchMinutes: "30",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok)
      expect(Object.keys(bad.errors)).toEqual(["stableMinutes", "batchSize"]);
  });

  it("én række pr. variant med ventende og beskeder pr. leverance", () => {
    const names = new Map([
      [
        VARIANT,
        { productId: PRODUCT, productTitle: "Kjole", variantTitle: "M" },
      ],
    ]);
    const rows = waitlistRows(
      [{ productId: PRODUCT, variantId: VARIANT, count: 4 }],
      [
        {
          productId: PRODUCT,
          variantId: VARIANT,
          deliveryId: "d1",
          deliveryDate: "2026-12-01",
          count: 2,
        },
        {
          productId: PRODUCT,
          variantId: VARIANT,
          deliveryId: null,
          deliveryDate: null,
          count: 1,
        },
      ],
      names,
    );
    expect(rows).toEqual([
      {
        variantId: VARIANT,
        productId: PRODUCT,
        productTitle: "Kjole",
        variantTitle: "M",
        waiting: 4,
        notified: [
          { deliveryDate: "2026-12-01", count: 2 },
          { deliveryDate: null, count: 1 },
        ],
      },
    ]);
  });
});
