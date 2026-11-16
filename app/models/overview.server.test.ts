import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { forShop, type OrderSnapshot } from "./preorder.server";
import { dashboardStats } from "../lib/dashboard";
import { createTestDb } from "../test/testDb";

// Oversigtens beløb: prisen gemmes på tildelingen, når ordren behandles, og
// ældre tildelinger får den, næste gang ordren behandles — uden at antal
// eller leverance ændres.

const testDb = createTestDb();
const client = testDb.client;

const SHOP = "oversigt.myshopify.com";
const VARIANT = "gid://shopify/ProductVariant/1";
const PLAN = "gid://shopify/SellingPlan/1";
const TODAY = "2026-11-02";

beforeAll(() => testDb.setup());
afterAll(() => testDb.teardown());
beforeEach(() => testDb.reset());

const data = () => forShop(SHOP, client);

async function setup() {
  await data().variantPlans.addVariants([
    {
      productId: "gid://shopify/Product/1",
      variantId: VARIANT,
      inventoryItemId: "gid://shopify/InventoryItem/1",
      locationId: "gid://shopify/Location/1",
    },
  ]);
  const delivery = await data().deliveries.create(
    VARIANT,
    { date: "2026-12-01", quantity: "10" },
    TODAY,
  );
  await client.delivery.update({
    where: { id: delivery.id },
    data: { sellingPlanId: PLAN },
  });
  return delivery;
}

function order(
  quantity: number,
  price?: { unitPrice: string; currency: string },
): OrderSnapshot {
  return {
    id: "gid://shopify/Order/1",
    name: "#1001",
    createdAt: new Date().toISOString(),
    cancelled: false,
    lines: [
      {
        id: "gid://shopify/LineItem/1",
        variantId: VARIANT,
        sellingPlanId: PLAN,
        quantity,
        ...price,
      },
    ],
  };
}

describe("pris på forudbestillinger", () => {
  it("gemmer prisen pr. stk. og valutaen fra ordren", async () => {
    await setup();
    await data().orders.apply(
      order(2, { unitPrice: "199.95", currency: "DKK" }),
    );
    const rows = await client.allocation.findMany({ where: { shop: SHOP } });
    expect(rows).toHaveLength(1);
    expect(rows[0].unitPrice?.toString()).toBe("199.95");
    expect(rows[0].currency).toBe("DKK");
  });

  it("ældre tildelinger uden pris får den uden at blive lavet om", async () => {
    await setup();
    await data().orders.apply(order(2));
    const before = await client.allocation.findMany({ where: { shop: SHOP } });
    expect(before[0].unitPrice).toBeNull();

    await data().orders.apply(order(2, { unitPrice: "100", currency: "DKK" }));
    const after = await client.allocation.findMany({ where: { shop: SHOP } });
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].quantity).toBe(2);
    expect(after[0].status).toBe("ACTIVE");
    expect(after[0].unitPrice?.toString()).toBe("100");
  });

  it("en ugyldig pris gemmes ikke", async () => {
    await setup();
    await data().orders.apply(order(1, { unitPrice: "abc", currency: "DKK" }));
    const rows = await client.allocation.findMany({ where: { shop: SHOP } });
    expect(rows[0].unitPrice).toBeNull();
  });

  it("oversigten regner beløbet ud fra de gemte priser", async () => {
    await setup();
    await data().orders.apply(order(3, { unitPrice: "50.5", currency: "DKK" }));
    const overview = await data().dashboard.overview(new Date(), 30);
    const stats = dashboardStats(overview.recent, new Date(), 30);
    expect(stats.amount).toEqual({ value: 151.5, currency: "DKK" });
    expect(stats.orders).toBe(1);
    expect(overview.openPaymentIssues).toBe(0);
    expect(overview.cancellations).toBe(0);
    expect(overview.waitlistWaiting).toBe(0);
  });
});

describe("sprogvalg", () => {
  it("gemmer og sletter butiksejerens eget valg", async () => {
    await data().settings.setChosenLocale("en");
    expect((await data().settings.get()).adminLocaleChosen).toBe("en");
    await data().settings.setChosenLocale(null);
    expect((await data().settings.get()).adminLocaleChosen).toBeNull();
  });
});
