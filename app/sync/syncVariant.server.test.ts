import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { forShop } from "../models/preorder.server";
import { createTestDb } from "../test/testDb";
import { createFakeShopify } from "../test/fakeShopify";
import { syncVariant } from "./syncVariant.server";

const testDb = createTestDb();
const client = testDb.client;

const SHOP = "butik.myshopify.com";
const VARIANT = "gid://shopify/ProductVariant/1";
const TODAY = "2026-11-02";

beforeAll(() => testDb.setup());
afterAll(() => testDb.teardown());
beforeEach(() => testDb.reset());

const data = () => forShop(SHOP, client);

async function setupVariant({ enabled = true } = {}) {
  await data().variantPlans.addVariants([
    {
      productId: "gid://shopify/Product/1",
      variantId: VARIANT,
      inventoryItemId: "gid://shopify/InventoryItem/1",
      locationId: "gid://shopify/Location/1",
    },
  ]);
  if (enabled) await data().variantPlans.setEnabled(VARIANT, true);
}

const addDelivery = (date: string, quantity: number) =>
  data().deliveries.create(
    VARIANT,
    { date, quantity: String(quantity) },
    TODAY,
  );

async function allocate(deliveryId: string, quantity: number, line: string) {
  await client.allocation.create({
    data: {
      shop: SHOP,
      deliveryId,
      quantity,
      variantId: VARIANT,
      orderId: `gid://shopify/Order/${line}`,
      orderLineId: `gid://shopify/LineItem/${line}`,
    },
  });
}

function setup() {
  const shopify = createFakeShopify();
  shopify.addVariant(VARIANT);
  const sync = () =>
    syncVariant({
      shop: SHOP,
      variantId: VARIANT,
      gateway: shopify.gateway,
      client,
    });
  return { shopify, sync };
}

const onlyGroup = (shopify: ReturnType<typeof createFakeShopify>) => {
  expect(shopify.groups.size).toBe(1);
  return [...shopify.groups.values()][0];
};

describe("selling plans", () => {
  it("opretter én gruppe pr. variant med én plan pr. leverance", async () => {
    await setupVariant();
    const first = await addDelivery("2026-12-01", 10);
    const second = await addDelivery("2027-01-15", 20);
    const { shopify, sync } = setup();

    expect(await sync()).toEqual({ ok: true, available: 10 });

    const group = onlyGroup(shopify);
    expect(group.variantIds).toEqual(new Set([VARIANT]));
    expect(group.plans).toHaveLength(2);

    for (const plan of group.plans) {
      expect(plan).toMatchObject({
        category: "PRE_ORDER",
        reserve: "ON_SALE",
        billing: {
          checkoutChargeType: "PERCENTAGE",
          checkoutChargePercentage: 100,
          remainingBalanceChargeTrigger: "NO_REMAINING_BALANCE",
        },
        delivery: { fulfillmentTrigger: "EXACT_TIME" },
        pricingPolicyCount: 0,
      });
    }
    expect(group.plans.map((p) => p.delivery?.fulfillmentExactTime)).toEqual([
      "2026-12-01T12:00:00Z",
      "2027-01-15T12:00:00Z",
    ]);

    // Hver leverance peger på sin egen plan, og gruppen er gemt på varianten.
    const rows = await client.delivery.findMany({
      orderBy: { position: "asc" },
    });
    expect(rows.map((r) => r.id)).toEqual([first.id, second.id]);
    expect(rows.map((r) => r.sellingPlanId)).toEqual(
      group.plans.map((p) => p.id),
    );
    const variant = await data().syncState.getVariant(VARIANT);
    expect(variant?.sellingPlanGroupId).toBe(group.id);
  });

  it("bruger butikkens tekst og datovisning i planens navn", async () => {
    await setupVariant();
    await addDelivery("2026-12-01", 10);
    await data().settings.update({
      dateMode: "DELIVERY",
      buttonLabel: "Forudbestil",
      shippingDateText: "Afsendes {dato}",
      deliveryDateText: "Leveres {dato}",
      preorderNote: "x",
    });
    const { shopify, sync } = setup();
    await sync();
    expect(onlyGroup(shopify).plans[0].options).toEqual([
      "Leveres 1. december 2026",
    ]);
  });

  it("anden kørsel ændrer intet", async () => {
    await setupVariant();
    await addDelivery("2026-12-01", 10);
    await addDelivery("2027-01-15", 20);
    const { shopify, sync } = setup();

    await sync();
    shopify.clearWrites();
    expect(await sync()).toEqual({ ok: true, available: 10 });
    expect(shopify.writes).toEqual([]);
  });

  it("en ny leverance giver én ny plan og rører ikke de eksisterende", async () => {
    await setupVariant();
    await addDelivery("2026-12-01", 10);
    const { shopify, sync } = setup();
    await sync();
    const before = onlyGroup(shopify).plans.map((p) => p.id);
    shopify.clearWrites();

    await addDelivery("2027-01-15", 20);
    await sync();

    expect(shopify.writes.map((w) => w.method)).toEqual(["createPlans"]);
    const after = onlyGroup(shopify).plans.map((p) => p.id);
    expect(after.slice(0, 1)).toEqual(before);
    expect(after).toHaveLength(2);
  });

  it("en ændret dato giver en ny plan, og den gamle tages ud af brug", async () => {
    await setupVariant();
    const delivery = await addDelivery("2026-12-01", 10);
    const { shopify, sync } = setup();
    await sync();
    const oldPlan = onlyGroup(shopify).plans[0];
    shopify.clearWrites();

    await data().deliveries.update(
      delivery.id,
      { date: "2026-12-20", quantity: "10" },
      TODAY,
    );
    expect((await sync()).ok).toBe(true);

    const [plan] = onlyGroup(shopify).plans;
    expect(plan.id).not.toBe(oldPlan.id);
    expect(plan.delivery?.fulfillmentExactTime).toBe("2026-12-20T12:00:00Z");
    const row = await client.delivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    expect(row.sellingPlanId).toBe(plan.id);
    expect(shopify.writes.map((w) => w.method)).toEqual([
      "deletePlans",
      "createPlans",
    ]);
  });

  it("nægter at ændre en plan med ordrer: der oprettes en ny i stedet", async () => {
    await setupVariant();
    const delivery = await addDelivery("2026-12-01", 10);
    await allocate(delivery.id, 3, "1");
    const { shopify, sync } = setup();
    await sync();
    const soldPlan = { ...onlyGroup(shopify).plans[0] };
    shopify.clearWrites();

    await data().deliveries.update(
      delivery.id,
      { date: "2027-02-01", quantity: "10" },
      TODAY,
    );
    await sync();

    // Gatewayen har slet ingen metode til at ændre en plan. Den solgte plan
    // er enten urørt eller taget ud af brug — aldrig ændret.
    const methods = shopify.writes.map((w) => w.method);
    expect(methods).not.toContain("updatePlans");
    for (const write of shopify.writes) {
      expect(JSON.stringify(write.args)).not.toContain("sellingPlansToUpdate");
    }
    const stillThere = onlyGroup(shopify).plans.find(
      (p) => p.id === soldPlan.id,
    );
    expect(stillThere).toBeUndefined();
    expect(onlyGroup(shopify).plans[0].id).not.toBe(soldPlan.id);
  });

  it("et rettet antal ændrer ikke planen", async () => {
    await setupVariant();
    const delivery = await addDelivery("2026-12-01", 10);
    const { shopify, sync } = setup();
    await sync();
    shopify.clearWrites();

    await data().deliveries.update(
      delivery.id,
      { date: "2026-12-01", quantity: "25" },
      TODAY,
    );
    await sync();
    expect(shopify.writes.map((w) => w.method)).toEqual(["setAvailable"]);
  });

  it("en annulleret leverance tages ud af brug", async () => {
    await setupVariant();
    const first = await addDelivery("2026-12-01", 10);
    await addDelivery("2027-01-15", 20);
    const { shopify, sync } = setup();
    await sync();

    await data().deliveries.cancel(first.id);
    await sync();

    expect(onlyGroup(shopify).plans).toHaveLength(1);
    const row = await client.delivery.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(row.sellingPlanId).toBeNull();
  });

  it("uden åbne leverancer slettes gruppen, og lageret sættes til 0", async () => {
    await setupVariant();
    const delivery = await addDelivery("2026-12-01", 10);
    const { shopify, sync } = setup();
    await sync();

    await data().deliveries.cancel(delivery.id);
    expect(await sync()).toEqual({ ok: true, available: 0 });
    expect(shopify.groups.size).toBe(0);
    expect(shopify.variants.get(VARIANT)?.available).toBe(0);
  });

  it("reparerer: en plan slettet i Shopify oprettes igen", async () => {
    await setupVariant();
    await addDelivery("2026-12-01", 10);
    const { shopify, sync } = setup();
    await sync();
    onlyGroup(shopify).plans = [];

    await sync();
    expect(onlyGroup(shopify).plans).toHaveLength(1);
  });

  it("reparerer: en gruppe fjernet fra varianten knyttes igen", async () => {
    await setupVariant();
    await addDelivery("2026-12-01", 10);
    const { shopify, sync } = setup();
    await sync();
    onlyGroup(shopify).variantIds.clear();

    await sync();
    expect(onlyGroup(shopify).variantIds.has(VARIANT)).toBe(true);
  });
});

describe("lager", () => {
  it("sætter lagerantal lig det resterende i den aktive leverance", async () => {
    await setupVariant();
    const first = await addDelivery("2026-12-01", 10);
    await addDelivery("2027-01-15", 20);
    await allocate(first.id, 4, "1");
    const { shopify, sync } = setup();

    expect(await sync()).toEqual({ ok: true, available: 6 });
    expect(shopify.variants.get(VARIANT)).toMatchObject({
      available: 6,
      tracked: true,
      inventoryPolicy: "DENY",
    });
  });

  it("går videre til næste leverance, når den første er udsolgt", async () => {
    await setupVariant();
    const first = await addDelivery("2026-12-01", 10);
    await addDelivery("2027-01-15", 20);
    await allocate(first.id, 10, "1");
    const { shopify, sync } = setup();

    await sync();
    expect(shopify.variants.get(VARIANT)?.available).toBe(20);
  });

  it("sender det forventede antal med, så en samtidig ordre ikke overskrives", async () => {
    await setupVariant();
    await addDelivery("2026-12-01", 10);
    const { shopify, sync } = setup();
    shopify.variants.get(VARIANT)!.available = 3;

    await sync();
    const write = shopify.writes.find((w) => w.method === "setAvailable");
    expect(write?.args).toEqual([
      "gid://shopify/InventoryItem/1",
      "gid://shopify/Location/1",
      10,
      3,
    ]);
  });
});

describe("fejl", () => {
  it("en userError gemmes på varianten og går ikke stille forbi", async () => {
    await setupVariant();
    await addDelivery("2026-12-01", 10);
    const { shopify, sync } = setup();
    shopify.failNext("createGroup", "Selling plan category is invalid");

    const result = await sync();
    expect(result.ok).toBe(false);
    const variant = await data().syncState.getVariant(VARIANT);
    expect(variant?.lastSyncError).toContain(
      "Selling plan category is invalid",
    );
    expect(variant?.lastSyncedAt).toBeNull();
  });

  it("en ny kørsel efter en fejl reparerer og rydder fejlen", async () => {
    await setupVariant();
    await addDelivery("2026-12-01", 10);
    const { shopify, sync } = setup();
    shopify.failNext("setAvailable", "boom");
    expect((await sync()).ok).toBe(false);

    expect(await sync()).toEqual({ ok: true, available: 10 });
    const variant = await data().syncState.getVariant(VARIANT);
    expect(variant?.lastSyncError).toBeNull();
    expect(variant?.lastSyncedAt).not.toBeNull();
    expect(variant?.syncedAvailable).toBe(10);
  });

  it("en variant uden lager giver en tydelig fejl", async () => {
    await data().variantPlans.addVariants([
      {
        productId: "gid://shopify/Product/1",
        variantId: VARIANT,
        inventoryItemId: "gid://shopify/InventoryItem/1",
        locationId: null,
      },
    ]);
    await data().variantPlans.setEnabled(VARIANT, true);
    await addDelivery("2026-12-01", 10);
    const { sync } = setup();

    const result = await sync();
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("ikke på noget lager"),
    });
  });
});

describe("forudbestilling slået fra", () => {
  it("skriver intet til Shopify for en variant, der aldrig har været slået til", async () => {
    await setupVariant({ enabled: false });
    await addDelivery("2026-12-01", 10);
    const { shopify, sync } = setup();

    expect((await sync()).ok).toBe(true);
    expect(shopify.writes).toEqual([]);
  });

  it("tager varianten ud af gruppen og rører ikke lageret", async () => {
    await setupVariant();
    await addDelivery("2026-12-01", 10);
    const { shopify, sync } = setup();
    await sync();
    shopify.clearWrites();

    await data().variantPlans.setEnabled(VARIANT, false);
    await sync();
    // Produktet har kun denne variant, så kravet om plan fjernes også.
    expect(shopify.writes.map((w) => w.method)).toEqual([
      "removeVariant",
      "setProductRequiresSellingPlan",
    ]);
    expect(onlyGroup(shopify).variantIds.size).toBe(0);
  });

  it("slås den til igen, genbruges gruppen og planerne", async () => {
    await setupVariant();
    await addDelivery("2026-12-01", 10);
    const { shopify, sync } = setup();
    await sync();
    await data().variantPlans.setEnabled(VARIANT, false);
    await sync();
    shopify.clearWrites();

    await data().variantPlans.setEnabled(VARIANT, true);
    await sync();
    expect(shopify.writes.map((w) => w.method)).toEqual([
      "addVariant",
      "setProductRequiresSellingPlan",
    ]);
  });
});

describe("kun forudbestilling eller blandet produkt", () => {
  const OTHER = "gid://shopify/ProductVariant/2";

  async function addOther(enabled: boolean) {
    await data().variantPlans.addVariants([
      {
        productId: "gid://shopify/Product/1",
        variantId: OTHER,
        inventoryItemId: "gid://shopify/InventoryItem/2",
        locationId: "gid://shopify/Location/1",
      },
    ]);
    if (enabled) await data().variantPlans.setEnabled(OTHER, true);
    await data().deliveries.create(
      OTHER,
      { date: "2026-12-01", quantity: "5" },
      TODAY,
    );
  }

  it("alle varianter på forudbestilling: produktet kræver selling plan", async () => {
    await setupVariant();
    await addDelivery("2026-12-01", 10);
    const { shopify, sync } = setup();
    await sync();
    expect(
      shopify.products.get("gid://shopify/Product/1")?.requiresSellingPlan,
    ).toBe(true);
  });

  it("kun nogle varianter på forudbestilling: kravet sættes ikke", async () => {
    await setupVariant();
    await addDelivery("2026-12-01", 10);
    await addOther(false);
    const { shopify, sync } = setup();
    shopify.addVariant(OTHER, {
      inventoryItemId: "gid://shopify/InventoryItem/2",
    });
    await sync();
    expect(
      shopify.products.get("gid://shopify/Product/1")?.requiresSellingPlan,
    ).toBeUndefined();
    expect(shopify.writes.map((w) => w.method)).not.toContain(
      "setProductRequiresSellingPlan",
    );
  });

  it("sættes, når den sidste variant slås til, og fjernes, når én slås fra", async () => {
    await setupVariant();
    await addDelivery("2026-12-01", 10);
    await addOther(false);
    const { shopify, sync } = setup();
    shopify.addVariant(OTHER, {
      inventoryItemId: "gid://shopify/InventoryItem/2",
    });
    const syncOther = () =>
      syncVariant({
        shop: SHOP,
        variantId: OTHER,
        gateway: shopify.gateway,
        client,
      });
    await sync();
    expect(
      shopify.products.get("gid://shopify/Product/1")?.requiresSellingPlan,
    ).toBeUndefined();

    await data().variantPlans.setEnabled(OTHER, true);
    await syncOther();
    expect(
      shopify.products.get("gid://shopify/Product/1")?.requiresSellingPlan,
    ).toBe(true);

    await data().variantPlans.setEnabled(VARIANT, false);
    await sync();
    expect(
      shopify.products.get("gid://shopify/Product/1")?.requiresSellingPlan,
    ).toBe(false);
  });

  it("et krav, webshopejeren selv har sat på et blandet produkt, røres ikke", async () => {
    await setupVariant();
    await addDelivery("2026-12-01", 10);
    await addOther(false);
    const { shopify, sync } = setup();
    shopify.addVariant(OTHER, {
      inventoryItemId: "gid://shopify/InventoryItem/2",
    });
    shopify.products.set("gid://shopify/Product/1", {
      requiresSellingPlan: true,
    });
    await sync();
    expect(
      shopify.products.get("gid://shopify/Product/1")?.requiresSellingPlan,
    ).toBe(true);
    expect(shopify.writes.map((w) => w.method)).not.toContain(
      "setProductRequiresSellingPlan",
    );
  });

  it("anden kørsel ændrer intet, heller ikke på produktet", async () => {
    await setupVariant();
    await addDelivery("2026-12-01", 10);
    const { shopify, sync } = setup();
    await sync();
    shopify.clearWrites();
    await sync();
    expect(shopify.writes).toEqual([]);
  });
});
