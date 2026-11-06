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

/**
 * hashEmail: til compliance-hændelser. Kundens e-mail gemmes ikke — kun en
 * envejs-nøgle (email_hash), så kundens tilmeldinger til ventelisten kan
 * findes og slettes.
 */
export function minimalPayload(
  topic: string,
  payload: unknown,
  hashEmail?: (email: string) => string | null,
): Json {
  const customer = (payload as Json | null)?.customer as Json | undefined;
  const customerRef = () => {
    const ref = pick(customer, ["id"]);
    const email = customer?.email;
    const hash =
      hashEmail && typeof email === "string" && email ? hashEmail(email) : null;
    if (hash) ref.email_hash = hash;
    return ref;
  };
  if (ORDER_TOPICS.has(topic)) {
    return pick(payload, ["id", "admin_graphql_api_id", "created_at"]);
  }
  switch (topic) {
    case "REFUNDS_CREATE":
      return pick(payload, ["order_id"]);
    case "ORDER_TRANSACTIONS_CREATE":
      // Kun ordren og om forsøget lykkedes — ingen kort- eller kundedata.
      return pick(payload, ["order_id", "kind", "status"]);
    case "INVENTORY_LEVELS_UPDATE":
      return pick(payload, ["inventory_item_id", "location_id"]);
    case "CUSTOMERS_DATA_REQUEST":
      return {
        ...pick(payload, ["orders_requested"]),
        customer: customerRef(),
        data_request: pick((payload as Json | null)?.data_request, ["id"]),
      };
    case "CUSTOMERS_REDACT":
      return {
        ...pick(payload, ["orders_to_redact"]),
        customer: customerRef(),
      };
    default:
      // fx app/uninstalled (butikkens ejer og mail) og shop/redact.
      return {};
  }
}
