import { describe, expect, it } from "vitest";
import { minimalPayload } from "./webhookPayload";

const customer = {
  id: 7,
  email: "kunde@example.com",
  phone: "+4512345678",
  first_name: "Anna",
};

describe("kun det nødvendige gemmes", () => {
  it("ordrer: id og bestillingstidspunkt — ingen kunde, mail eller adresse", () => {
    expect(
      minimalPayload("ORDERS_CREATE", {
        id: 1,
        admin_graphql_api_id: "gid://shopify/Order/1",
        created_at: "2026-11-02T10:00:00Z",
        email: "kunde@example.com",
        customer,
        shipping_address: { address1: "Vejen 1" },
        line_items: [{ id: 2 }],
      }),
    ).toEqual({
      id: 1,
      admin_graphql_api_id: "gid://shopify/Order/1",
      created_at: "2026-11-02T10:00:00Z",
    });
  });

  it("refunderinger og lager", () => {
    expect(
      minimalPayload("REFUNDS_CREATE", { order_id: 1, note: "x", id: 3 }),
    ).toEqual({ order_id: 1 });
    expect(
      minimalPayload("INVENTORY_LEVELS_UPDATE", {
        inventory_item_id: 4,
        location_id: 5,
        available: 2,
      }),
    ).toEqual({ inventory_item_id: 4, location_id: 5 });
  });

  it("compliance: kundens id og ordrerne — ikke mail eller telefon", () => {
    expect(
      minimalPayload("CUSTOMERS_DATA_REQUEST", {
        shop_domain: "butik.myshopify.com",
        customer,
        orders_requested: [1, 2],
        data_request: { id: 9 },
      }),
    ).toEqual({
      customer: { id: 7 },
      orders_requested: [1, 2],
      data_request: { id: 9 },
    });
    expect(
      minimalPayload("CUSTOMERS_REDACT", { customer, orders_to_redact: [1] }),
    ).toEqual({ customer: { id: 7 }, orders_to_redact: [1] });
  });

  it("alt andet gemmes tomt (fx app/uninstalled med ejerens mail)", () => {
    expect(
      minimalPayload("APP_UNINSTALLED", { email: "ejer@example.com" }),
    ).toEqual({});
    expect(minimalPayload("SHOP_REDACT", { shop_id: 1 })).toEqual({});
    expect(minimalPayload("ORDERS_CREATE", null)).toEqual({});
  });

  it("compliance: e-mailen gemmes kun som envejs-nøgle (til ventelisten)", () => {
    const hash = (email: string) => `hash(${email})`;
    expect(
      minimalPayload(
        "CUSTOMERS_REDACT",
        { customer, orders_to_redact: [1] },
        hash,
      ),
    ).toEqual({
      customer: { id: 7, email_hash: `hash(${customer.email})` },
      orders_to_redact: [1],
    });
  });
});
