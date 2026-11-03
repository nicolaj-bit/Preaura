import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DeliveryValidationError,
  PreorderActionError,
  forShop,
} from "./preorder.server";
import { MESSAGES } from "../lib/deliveries";
import { createTestDb } from "../test/testDb";

// Kører datalaget mod en rigtig SQLite-database i en midlertidig mappe, med
// de samme migrationer som appen.

const testDb = createTestDb();
const client = testDb.client;

const TODAY = "2026-11-02";
const A = "butik-a.myshopify.com";
const B = "butik-b.myshopify.com";
const VARIANT = "gid://shopify/ProductVariant/1";

beforeAll(() => testDb.setup());
afterAll(() => testDb.teardown());
beforeEach(() => testDb.reset());

async function addVariant(shop: string, variantId = VARIANT) {
  await forShop(shop, client).variantPlans.addVariants([
    {
      productId: "gid://shopify/Product/1",
      variantId,
      inventoryItemId: "gid://shopify/InventoryItem/1",
      locationId: "gid://shopify/Location/1",
    },
  ]);
}

async function allocate(
  shop: string,
  deliveryId: string,
  quantity: number,
  line: string,
) {
  return client.allocation.create({
    data: {
      shop,
      deliveryId,
      quantity,
      orderId: `gid://shopify/Order/${line}`,
      orderLineId: `gid://shopify/LineItem/${line}`,
      variantId: VARIANT,
    },
  });
}

describe("isolation mellem butikker", () => {
  it("en butik kan ikke se en anden butiks varianter eller leverancer", async () => {
    await addVariant(A);
    await forShop(A, client).deliveries.create(
      VARIANT,
      { date: "2026-12-01", quantity: "10" },
      TODAY,
    );

    const b = forShop(B, client);
    expect(await b.variantPlans.listProducts()).toEqual([]);
    expect(
      await b.variantPlans.listForProduct("gid://shopify/Product/1"),
    ).toEqual([]);
    expect(await b.deliveries.listForVariants([VARIANT])).toEqual([]);
  });

  it("en butik kan ikke rette, slette eller annullere en anden butiks leverance", async () => {
    await addVariant(A);
    const delivery = await forShop(A, client).deliveries.create(
      VARIANT,
      { date: "2026-12-01", quantity: "10" },
      TODAY,
    );
    const b = forShop(B, client);

    await expect(
      b.deliveries.update(
        delivery.id,
        { date: "2026-12-02", quantity: "1" },
        TODAY,
      ),
    ).rejects.toThrow(PreorderActionError);
    await expect(b.deliveries.remove(delivery.id)).rejects.toThrow(
      PreorderActionError,
    );
    await expect(b.deliveries.cancel(delivery.id)).rejects.toThrow(
      PreorderActionError,
    );

    const unchanged = await client.delivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    expect(unchanged).toMatchObject({
      quantity: 10,
      date: "2026-12-01",
      status: "OPEN",
    });
  });

  it("en butik kan ikke slå en anden butiks variant til eller oprette leverancer på den", async () => {
    await addVariant(A);
    const b = forShop(B, client);
    await expect(b.variantPlans.setEnabled(VARIANT, true)).rejects.toThrow(
      PreorderActionError,
    );
    await expect(
      b.deliveries.create(
        VARIANT,
        { date: "2026-12-01", quantity: "1" },
        TODAY,
      ),
    ).rejects.toThrow(PreorderActionError);
  });

  it("tildelinger i en anden butik tæller ikke med", async () => {
    await addVariant(A);
    const delivery = await forShop(A, client).deliveries.create(
      VARIANT,
      { date: "2026-12-01", quantity: "10" },
      TODAY,
    );
    // En fejlagtig række med forkert butik må ikke påvirke butik A's tal.
    await allocate(B, delivery.id, 4, "x");
    const [view] = await forShop(A, client).deliveries.listForVariants([
      VARIANT,
    ]);
    expect(view.remaining).toBe(10);
  });

  it("indstillinger er pr. butik", async () => {
    await forShop(A, client).settings.update({
      dateMode: "DELIVERY",
      buttonLabel: "Bestil nu",
      shippingDateText: "a",
      deliveryDateText: "b",
      preorderNote: "c",
    });
    expect((await forShop(B, client).settings.get()).buttonLabel).toBe(
      "Forudbestil",
    );
  });
});

describe("leverancer", () => {
  it("nummererer leverancer i rækkefølge og finder den aktive", async () => {
    await addVariant(A);
    const data = forShop(A, client);
    const first = await data.deliveries.create(
      VARIANT,
      { date: "2026-12-01", quantity: "2" },
      TODAY,
    );
    await data.deliveries.create(
      VARIANT,
      { date: "2027-01-01", quantity: "5" },
      TODAY,
    );
    await allocate(A, first.id, 2, "1");

    const views = await data.deliveries.listForVariants([VARIANT]);
    expect(views.map((v) => [v.position, v.remaining, v.state])).toEqual([
      [1, 0, "SOLD_OUT"],
      [2, 5, "ACTIVE"],
    ]);
  });

  it("afviser at sætte antallet under det tildelte", async () => {
    await addVariant(A);
    const data = forShop(A, client);
    const delivery = await data.deliveries.create(
      VARIANT,
      { date: "2026-12-01", quantity: "10" },
      TODAY,
    );
    await allocate(A, delivery.id, 6, "1");

    const error = await data.deliveries
      .update(delivery.id, { date: "2026-12-01", quantity: "5" }, TODAY)
      .catch((e) => e);
    expect(error).toBeInstanceOf(DeliveryValidationError);
    expect(error.errors.quantity).toBe(MESSAGES.quantityBelowAllocated(6));
  });

  it("afviser sletning med tildelinger, men tillader annullering", async () => {
    await addVariant(A);
    const data = forShop(A, client);
    const delivery = await data.deliveries.create(
      VARIANT,
      { date: "2026-12-01", quantity: "10" },
      TODAY,
    );
    await allocate(A, delivery.id, 3, "1");

    await expect(data.deliveries.remove(delivery.id)).rejects.toThrow(
      /kan ikke slettes/,
    );
    await data.deliveries.cancel(delivery.id);

    const [view] = await data.deliveries.listForVariants([VARIANT]);
    expect(view.state).toBe("CANCELLED");
    expect(view.orders).toEqual([
      { orderId: "gid://shopify/Order/1", quantity: 3, status: "ACTIVE" },
    ]);
    expect(await client.allocation.count()).toBe(1);
  });

  it("sletter en leverance uden tildelinger", async () => {
    await addVariant(A);
    const data = forShop(A, client);
    const delivery = await data.deliveries.create(
      VARIANT,
      { date: "2026-12-01", quantity: "10" },
      TODAY,
    );
    await data.deliveries.remove(delivery.id);
    expect(await data.deliveries.listForVariants([VARIANT])).toEqual([]);
  });

  it("en annulleret leverance kan ikke rettes", async () => {
    await addVariant(A);
    const data = forShop(A, client);
    const delivery = await data.deliveries.create(
      VARIANT,
      { date: "2026-12-01", quantity: "10" },
      TODAY,
    );
    await data.deliveries.cancel(delivery.id);
    await expect(
      data.deliveries.update(
        delivery.id,
        { date: "2026-12-01", quantity: "20" },
        TODAY,
      ),
    ).rejects.toThrow(/annulleret/);
  });
});

describe("tildelinger", () => {
  it("den samme ordrelinje kan kun tildeles én gang", async () => {
    await addVariant(A);
    const delivery = await forShop(A, client).deliveries.create(
      VARIANT,
      { date: "2026-12-01", quantity: "10" },
      TODAY,
    );
    await allocate(A, delivery.id, 1, "1");
    await expect(allocate(A, delivery.id, 1, "1")).rejects.toThrow(
      /Unique constraint/,
    );
  });

  it("databasen nægter at slette en leverance med tildelinger", async () => {
    await addVariant(A);
    const delivery = await forShop(A, client).deliveries.create(
      VARIANT,
      { date: "2026-12-01", quantity: "10" },
      TODAY,
    );
    await allocate(A, delivery.id, 1, "1");
    await expect(
      client.delivery.delete({ where: { id: delivery.id } }),
    ).rejects.toThrow();
  });

  it("databasens værn mod dobbelttælling findes efter alle migrationer", async () => {
    // De partielle unikke indekser kan Prisma ikke beskrive. Genskaber en
    // migration tabellen Allocation, forsvinder de stille — det fanger denne test.
    const rows = await client.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'Allocation'`,
    );
    const names = rows.map((r) => r.name);
    expect(names).toContain("Allocation_active_line_delivery_key");
    expect(names).toContain("Allocation_unresolved_line_key");
  });
});
