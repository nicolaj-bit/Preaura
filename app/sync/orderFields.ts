// Hvordan en ordres metafelter og tags SKAL se ud ud fra dens tildelinger.
// Rene funktioner uden Shopify-kald.

import type { OrderMetafield } from "./gateway";

export const METAFIELD_NAMESPACE = "preaura";
export const PROMISED_DATE_KEY = "promised_date";
export const ALLOCATIONS_KEY = "allocations";

/** Sættes på alle ordrer, der indeholder en forudbestilling. */
export const PREORDER_TAG = "Forudbestilling";
/** Sættes, mens en del af ordren ikke har plads i nogen leverance. */
export const UNRESOLVED_TAG = "Forudbestilling uafklaret";

export type AllocationRow = {
  orderLineId: string;
  variantId: string;
  status: string;
  quantity: number;
  promisedDate: string | null;
  delivery: { position: number } | null;
};

/**
 * Ordrens metafelter:
 * - `preaura.promised_date` (dato): den seneste lovede dato for ordrens
 *   aktive tildelinger — hvornår hele ordren kan sendes. Datoen kommer fra
 *   tildelingerne, ikke fra leverancerne, så den ændrer sig ikke, hvis en
 *   leverances dato senere flyttes. Er ingen tildelinger aktive (fx en
 *   annulleret ordre), røres den ikke.
 * - `preaura.allocations` (json): fordelingen pr. ordrelinje.
 */
export function desiredOrderMetafields(
  rows: AllocationRow[],
): OrderMetafield[] {
  const live = rows.filter(
    (r) => r.status === "ACTIVE" || r.status === "UNRESOLVED",
  );
  const allocations = live
    .map((r) => ({
      line_item_id: r.orderLineId,
      variant_id: r.variantId,
      delivery: r.delivery?.position ?? null,
      promised_date: r.status === "ACTIVE" ? r.promisedDate : null,
      quantity: r.quantity,
      status: r.status === "ACTIVE" ? "allocated" : "unresolved",
    }))
    .sort((a, b) =>
      `${a.line_item_id}|${a.delivery ?? 999}`.localeCompare(
        `${b.line_item_id}|${b.delivery ?? 999}`,
      ),
    );

  const fields: OrderMetafield[] = [
    { key: ALLOCATIONS_KEY, type: "json", value: JSON.stringify(allocations) },
  ];
  const dates = live
    .filter((r) => r.status === "ACTIVE" && r.promisedDate)
    .map((r) => r.promisedDate as string)
    .sort();
  if (dates.length > 0) {
    fields.push({
      key: PROMISED_DATE_KEY,
      type: "date",
      value: dates[dates.length - 1],
    });
  }
  return fields;
}

/** Sammenligner en metafeltværdi fra Shopify med den ønskede. */
export function metafieldMatches(
  field: OrderMetafield,
  current: string | null,
) {
  if (current == null) return false;
  if (field.type !== "json") return current === field.value;
  try {
    return JSON.stringify(JSON.parse(current)) === field.value;
  } catch {
    return false;
  }
}

export function desiredOrderTags(rows: AllocationRow[]) {
  const tags = [PREORDER_TAG];
  if (rows.some((r) => r.status === "UNRESOLVED")) tags.push(UNRESOLVED_TAG);
  return tags;
}
