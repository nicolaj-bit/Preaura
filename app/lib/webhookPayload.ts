// Kun det nødvendige gemmes fra en webhook.
//
// Shopify sender hele ordren — med kundens navn, mail, telefon og adresse.
// Appen bruger kun ordrens id og bestillingstidspunkt (resten læses frisk
// fra Shopify ved behandlingen), så alt andet smides væk, før hændelsen
// gemmes. Dermed ligger der ingen persondata i køen.

type Json = Record<string, unknown>;

const ORDER_TOPICS = new Set([
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "ORDERS_CANCELLED",
]);

function pick(source: unknown, keys: string[]): Json {
  const result: Json = {};
  if (source && typeof source === "object") {
    for (const key of keys) {
      const value = (source as Json)[key];
      if (value !== undefined) result[key] = value;
    }
  }
  return result;
}

export function minimalPayload(topic: string, payload: unknown): Json {
  if (ORDER_TOPICS.has(topic)) {
    return pick(payload, ["id", "admin_graphql_api_id", "created_at"]);
  }
  switch (topic) {
    case "REFUNDS_CREATE":
      return pick(payload, ["order_id"]);
    case "INVENTORY_LEVELS_UPDATE":
      return pick(payload, ["inventory_item_id", "location_id"]);
    case "CUSTOMERS_DATA_REQUEST":
      return {
        ...pick(payload, ["orders_requested"]),
        customer: pick((payload as Json | null)?.customer, ["id"]),
        data_request: pick((payload as Json | null)?.data_request, ["id"]),
      };
    case "CUSTOMERS_REDACT":
      return {
        ...pick(payload, ["orders_to_redact"]),
        customer: pick((payload as Json | null)?.customer, ["id"]),
      };
    default:
      // fx app/uninstalled (butikkens ejer og mail) og shop/redact.
      return {};
  }
}
