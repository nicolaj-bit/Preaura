// Det, siden «Venteliste» viser, og kontrol af indstillingerne. Ren kode —
// ingen database, intet netværk — så det kan testes.

export const WAITLIST_SETTING_LIMITS = {
  stableMinutes: { min: 1, max: 1440, label: "Ventetid" },
  batchSize: { min: 1, max: 1000, label: "Portion" },
  batchMinutes: { min: 1, max: 1440, label: "Interval" },
} as const;

export type WaitlistSettingsInput = Record<
  keyof typeof WAITLIST_SETTING_LIMITS,
  unknown
>;

export function parseWaitlistSettings(input: WaitlistSettingsInput) {
  const errors: Partial<Record<keyof typeof WAITLIST_SETTING_LIMITS, string>> =
    {};
  const values = {} as Record<keyof typeof WAITLIST_SETTING_LIMITS, number>;
  for (const key of Object.keys(WAITLIST_SETTING_LIMITS) as Array<
    keyof typeof WAITLIST_SETTING_LIMITS
  >) {
    const { min, max } = WAITLIST_SETTING_LIMITS[key];
    const text = String(input[key] ?? "").trim();
    const value = Number(text);
    if (!/^\d+$/.test(text) || value < min || value > max) {
      errors[key] = `Skriv et helt tal fra ${min} til ${max}.`;
    } else {
      values[key] = value;
    }
  }
  return Object.keys(errors).length > 0
    ? { ok: false as const, errors }
    : { ok: true as const, values };
}

type Waiting = { productId: string; variantId: string; count: number };
type Notified = {
  productId: string;
  variantId: string;
  deliveryId: string | null;
  deliveryDate: string | null;
  count: number;
};
type Names = Map<
  string,
  { productId: string; productTitle: string; variantTitle: string }
>;

export type WaitlistRow = {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  /** Venter på besked nu. */
  waiting: number;
  /** Har fået besked, fordelt på leverance (null = kom på lager). */
  notified: { deliveryDate: string | null; count: number }[];
};

/** Én række pr. variant, flest ventende først. */
export function waitlistRows(
  waiting: Waiting[],
  notified: Notified[],
  names: Names,
): WaitlistRow[] {
  const rows = new Map<string, WaitlistRow>();
  const row = (variantId: string, productId: string) => {
    let current = rows.get(variantId);
    if (!current) {
      const name = names.get(variantId);
      current = {
        variantId,
        productId,
        productTitle: name?.productTitle ?? "Ukendt produkt",
        variantTitle: name?.variantTitle ?? "",
        waiting: 0,
        notified: [],
      };
      rows.set(variantId, current);
    }
    return current;
  };
  for (const w of waiting) row(w.variantId, w.productId).waiting += w.count;
  for (const n of notified) {
    row(n.variantId, n.productId).notified.push({
      deliveryDate: n.deliveryDate,
      count: n.count,
    });
  }
  return [...rows.values()].sort(
    (a, b) =>
      b.waiting - a.waiting ||
      a.productTitle.localeCompare(b.productTitle, "da") ||
      a.variantTitle.localeCompare(b.variantTitle, "da"),
  );
}
