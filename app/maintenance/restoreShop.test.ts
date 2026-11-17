import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { forShop, type OrderSnapshot } from "../models/preorder.server";
import { waitlistFor } from "../models/waitlist.server";
import { enqueueWebhook } from "../lib/webhookQueue.server";
import { createTestDb } from "../test/testDb";
import { createFakeShopify } from "../test/fakeShopify";
import { syncVariant } from "../sync/syncVariant.server";
import { syncOrder } from "../sync/syncOrder.server";
import { processShopQueue } from "../orders/processQueue.server";
import { restoreShop } from "../../scripts/restore-shop.mjs";

// Opgave 17: gendannelse af én butik fra en sikkerhedskopi.
//
// To rigtige databaser: «produktion» og «kopien» (som Render laver ved
// point-in-time recovery: en separat database med alt, som det var på et
// tidspunkt). Butik A ødelægges af en fejl og gendannes fra kopien; butik B
// må ikke mærke noget.

process.env.PREAURA_ENCRYPTION_KEY = "test-nøgle";

const prod = createTestDb();
const backup = createTestDb();
const A = "butik-a.myshopify.com";
const B = "butik-b.myshopify.com";
const TODAY = "2026-11-02";
const VARIANT = "gid://shopify/ProductVariant/1";

beforeAll(async () => {
  await prod.setup();
  await backup.setup();
});
afterAll(async () => {
  await prod.teardown();
  await backup.teardown();
});
beforeEach(async () => {
  await prod.reset();
  await backup.reset();
});

/** Alle tabeller, i en rækkefølge de kan indsættes i. */
const ALL_TABLES = [
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

type Delegate = {
  findMany(args?: unknown): Promise<unknown[]>;
  createMany(args: { data: unknown[] }): Promise<unknown>;
};
const table = (client: PrismaClient, name: string) =>
  (client as unknown as Record<string, Delegate>)[name];

/** «Sikkerhedskopien»: hele databasen, som den er nu. */
async function takeBackup() {
  for (const name of ALL_TABLES) {
    const rows = await table(prod.client, name).findMany();
    if (rows.length > 0)
      await table(backup.client, name).createMany({ data: rows });
  }
  return new Date();
}

/** En butik med appen installeret, én leverance og et par ordrer. */
async function store(shop: string, orders: number[]) {
  const client = prod.client;
  const data = forShop(shop, client);
  await client.session.create({
    data: {
      id: `offline_${shop}`,
      shop,
      state: "ok",
      accessToken: "token",
    },
  });
  await data.variantPlans.addVariants([
    {
      productId: "gid://shopify/Product/1",
      variantId: VARIANT,
      inventoryItemId: "gid://shopify/InventoryItem/1",
      locationId: "gid://shopify/Location/1",
    },
  ]);
  await data.variantPlans.setEnabled(VARIANT, true);
  const delivery = await data.deliveries.create(
    VARIANT,
    { date: "2027-01-01", quantity: "20" },
    TODAY,
  );
  const shopify = createFakeShopify();
  shopify.addVariant(VARIANT, { available: 0 });
  expect(
    (
      await syncVariant({
        shop,
        variantId: VARIANT,
        gateway: shopify.gateway,
        client,
      })
    ).ok,
  ).toBe(true);
  const plan = (
    await client.delivery.findUniqueOrThrow({ where: { id: delivery.id } })
  ).sellingPlanId!;

  let seq = 0;
  const h = {
    shopify,
    delivery,
    async order(n: number, quantity: number) {
      const snapshot: OrderSnapshot = {
        id: `gid://shopify/Order/${shop}-${n}`,
        name: `#${n}`,
        createdAt: new Date(Date.UTC(2026, 10, 2, 10, 0, n)).toISOString(),
        cancelled: false,
        lines: [
          {
            id: `gid://shopify/LineItem/${shop}-${n}`,
            variantId: VARIANT,
            sellingPlanId: plan,
            quantity,
          },
        ],
      };
      shopify.putOrder(snapshot);
      await enqueueWebhook(
        {
          webhookId: `${shop}-wh-${++seq}`,
          shop,
          topic: "ORDERS_CREATE",
          payload: {
            admin_graphql_api_id: snapshot.id,
            created_at: snapshot.createdAt,
          },
        },
        client,
      );
    },
    async redactCustomer(customerId: number, email: string) {
      await enqueueWebhook(
        {
          webhookId: `${shop}-redact-${++seq}`,
          shop,
          topic: "CUSTOMERS_REDACT",
          payload: {
            customer: { id: customerId, email },
            orders_to_redact: [],
          },
        },
        client,
      );
    },
    run: () =>
      processShopQueue({
        shop,
        client,
        deps: {
          readOrder: async (id) =>
            (await shopify.gateway.readOrder(id))?.snapshot ?? null,
          syncVariant: (variantId) =>
            syncVariant({ shop, variantId, gateway: shopify.gateway, client }),
          syncOrder: (orderId) =>
            syncOrder({ shop, orderId, gateway: shopify.gateway, client }),
        },
      }),
    async remaining() {
      const [view] = await data.deliveries.listForVariants([VARIANT]);
      return view?.remaining ?? null;
    },
  };
  for (const n of orders) await h.order(n, 2);
  await h.run();
  return h;
}

/** Det, der skal være intakt: leverancer og aktive tildelinger. */
async function deliveryState(shop: string) {
  const deliveries = await prod.client.delivery.findMany({
    where: { shop },
    select: { id: true, date: true, quantity: true, status: true },
    orderBy: { position: "asc" },
  });
  const allocations = await prod.client.allocation.findMany({
    where: { shop, status: "ACTIVE" },
    select: { id: true, orderId: true, deliveryId: true, quantity: true },
    orderBy: { orderId: "asc" },
  });
  return { deliveries, allocations };
}

describe("gendannelse af én butik", () => {
  it("butik A gendannes fra kopien; B rører sig ikke; ordrer og sletninger efter kopien genudføres", async () => {
    const a = await store(A, [1, 2, 3]);
    const b = await store(B, [1]);
    await waitlistFor(A, prod.client).add({
      productId: "gid://shopify/Product/1",
      variantId: VARIANT,
      email: "kunde@example.com",
    });
    expect(await a.remaining()).toBe(14);
    const atBackup = await deliveryState(A);
    const since = await takeBackup();

    // Efter kopien: A får en ny ordre, og kunden beder om at blive slettet.
    // B får en ordre.
    await a.order(4, 1);
    await a.redactCustomer(77, "kunde@example.com");
    await a.run();
    await b.order(2, 5);
    await b.run();
    expect(await prod.client.waitlistEntry.count({ where: { shop: A } })).toBe(
      0,
    );
    const bBefore = await deliveryState(B);

    // En fejl ødelægger A: leverancen får forkert antal, og tildelinger
    // forsvinder.
    await prod.client.allocation.deleteMany({ where: { shop: A } });
    await prod.client.delivery.updateMany({
      where: { shop: A },
      data: { quantity: 1 },
    });

    // Prøvekørsel ændrer intet.
    const dry = await restoreShop({
      source: backup.client,
      target: prod.client,
      shop: A,
      since,
    });
    expect(dry.applied).toBe(false);
    expect(dry.rows.allocation).toBe(3);
    expect(await prod.client.allocation.count({ where: { shop: A } })).toBe(0);

    const result = await restoreShop({
      source: backup.client,
      target: prod.client,
      shop: A,
      since,
      apply: true,
    });
    expect(result.applied).toBe(true);

    // A er som i kopien: samme leverancer, samme tildelinger (samme id'er).
    expect(await deliveryState(A)).toEqual(atBackup);
    // B er uændret, også det, der skete efter kopien.
    expect(await deliveryState(B)).toEqual(bBefore);

    // Kopien havde kundens tilmelding til ventelisten. Sletningen og ordren
    // efter kopien står i kø igen; når køen kører, er tilmeldingen væk igen,
    // og ordre 4 er talt med.
    expect(await prod.client.waitlistEntry.count({ where: { shop: A } })).toBe(
      1,
    );
    await a.run();
    expect(await prod.client.waitlistEntry.count({ where: { shop: A } })).toBe(
      0,
    );
    expect(await a.remaining()).toBe(13);
    const orders = (await deliveryState(A)).allocations.map((x) => x.orderId);
    expect(orders).toContain(`gid://shopify/Order/${A}-4`);

    // Revisionssporet rulles ikke tilbage: sletningen står stadig i loggen.
    expect(
      await prod.client.accessLog.count({
        where: { shop: A, action: "erase_customer" },
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it("en butik uden appen installeret gendannes ikke", async () => {
    await store(A, [1]);
    const since = await takeBackup();
    await prod.client.session.deleteMany({ where: { shop: A } });
    await expect(
      restoreShop({
        source: backup.client,
        target: prod.client,
        shop: A,
        since,
        apply: true,
      }),
    ).rejects.toThrow(/ikke appen installeret/);
  });

  it("fejler noget undervejs, er målet uændret", async () => {
    const a = await store(A, [1, 2]);
    const since = await takeBackup();
    const before = await deliveryState(A);
    // Kopien indeholder en tildeling til en leverance, der ikke findes:
    // indsættelsen fejler midt i transaktionen.
    await backup.client.$executeRawUnsafe(
      `ALTER TABLE "Allocation" DROP CONSTRAINT "Allocation_deliveryId_fkey"`,
    );
    await backup.client.delivery.deleteMany({ where: { shop: A } });
    await expect(
      restoreShop({
        source: backup.client,
        target: prod.client,
        shop: A,
        since,
        apply: true,
      }),
    ).rejects.toThrow();
    expect(await deliveryState(A)).toEqual(before);
    expect(await a.remaining()).toBe(16);
  });
});
