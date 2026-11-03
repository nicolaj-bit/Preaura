// Indholdet af variantens metafelt preaura.preorder (json). App-blokken på
// produktsiden læser det i Liquid ved sideindlæsning — uden netværkskald — så
// feltet skal altid indeholde alt, blokken har brug for.

export type VariantPreorderData =
  | { active: false }
  | {
      active: true;
      /** "SHIPPING" (forventet afsendelse) eller "DELIVERY" (forventet levering). */
      mode: string;
      /** Den aktive leverances dato, "YYYY-MM-DD". Null, når alt er udsolgt. */
      date: string | null;
      /** Den aktive leverances selling plan-id. Null, når alt er udsolgt. */
      sellingPlanId: string | null;
      /** Resterende i den aktive leverance. */
      remaining: number;
      /** Sand, når alle leverancer er udsolgt eller annulleret. */
      soldOut: boolean;
    };

/** Stabil tekst, så to ens værdier altid giver samme streng. */
export function serializePreorderData(data: VariantPreorderData) {
  if (!data.active) return JSON.stringify({ active: false });
  return JSON.stringify({
    active: true,
    mode: data.mode,
    date: data.date,
    sellingPlanId: data.sellingPlanId,
    remaining: data.remaining,
    soldOut: data.soldOut,
  });
}

/** Stemmer Shopifys nuværende værdi med den ønskede? */
export function preorderDataMatches(
  current: string | null,
  wanted: VariantPreorderData,
) {
  if (current == null) return false;
  try {
    const parsed = JSON.parse(current) as VariantPreorderData;
    return serializePreorderData(parsed) === serializePreorderData(wanted);
  } catch {
    return false;
  }
}
