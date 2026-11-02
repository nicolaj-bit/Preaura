// Fordeling af én ordrelinje på leverancer. Ren funktion uden database.
//
// Princippet er "ønsket tilstand": ud fra ordrelinjens nuværende antal i
// Shopify og de tildelinger, linjen allerede har, regnes ud, hvordan
// fordelingen SKAL se ud. Er den allerede sådan, sker der intet. Derfor kan
// den samme ordre behandles igen og igen uden at blive talt to gange.

/** En del af en ordrelinje i én leverance — eller uafklaret (deliveryId null). */
export type Bucket = {
  deliveryId: string | null;
  quantity: number;
  /** Datoen, kunden er lovet for netop disse stk. */
  promisedDate: string | null;
};

export type DeliverySlot = {
  id: string;
  position: number;
  date: string;
  status: string;
  /** Resterende antal, inklusive denne linjes nuværende tildelinger. */
  remaining: number;
};

/**
 * Den ønskede fordeling af en ordrelinje.
 *
 * - Bliver antallet mindre, fjernes først uafklarede stk., derefter fra den
 *   bageste leverance og fremefter. Det, kunden har fået tidligst, bevares.
 * - Bliver det større, beholdes det eksisterende, og resten fyldes i planens
 *   leverance og derefter i de følgende leverancer efter rækkefølge.
 * - Er der ikke plads nogen steder, bliver resten uafklaret — aldrig tabt.
 *
 * Eksisterende stk. beholder deres lovede dato, også hvis leverancens dato
 * siden er ændret.
 */
export function planLineAllocation({
  desired,
  current,
  startDeliveryId,
  deliveries,
}: {
  desired: number;
  current: Bucket[];
  startDeliveryId: string;
  deliveries: DeliverySlot[];
}): Bucket[] {
  const byPosition = [...deliveries].sort((a, b) => a.position - b.position);
  const positionOf = (id: string | null) =>
    byPosition.find((d) => d.id === id)?.position ?? Number.MAX_SAFE_INTEGER;

  // Kun stk. i en leverance tæller som placeret. Uafklarede stk. prøves
  // placeret igen hver gang, så de bliver afklaret, når der kommer plads.
  const placed = current
    .filter((b) => b.deliveryId !== null && b.quantity > 0)
    .map((b) => ({ ...b }))
    .sort((a, b) => positionOf(a.deliveryId) - positionOf(b.deliveryId));
  const placedTotal = placed.reduce((sum, b) => sum + b.quantity, 0);
  const target = Math.max(0, desired);

  if (target <= placedTotal) {
    let toRemove = placedTotal - target;
    for (let i = placed.length - 1; i >= 0 && toRemove > 0; i--) {
      const take = Math.min(placed[i].quantity, toRemove);
      placed[i].quantity -= take;
      toRemove -= take;
    }
    return placed.filter((b) => b.quantity > 0);
  }

  let extra = target - placedTotal;
  const start = byPosition.find((d) => d.id === startDeliveryId);
  const startPosition = start?.position ?? Number.MAX_SAFE_INTEGER;
  const candidates = byPosition.filter(
    (d) => d.status === "OPEN" && d.position >= startPosition,
  );

  for (const delivery of candidates) {
    if (extra === 0) break;
    const take = Math.min(extra, Math.max(0, delivery.remaining));
    if (take === 0) continue;
    const existing = placed.find((b) => b.deliveryId === delivery.id);
    if (existing) {
      existing.quantity += take;
    } else {
      placed.push({
        deliveryId: delivery.id,
        quantity: take,
        promisedDate: delivery.date,
      });
    }
    extra -= take;
  }

  const result = placed.sort(
    (a, b) => positionOf(a.deliveryId) - positionOf(b.deliveryId),
  );
  if (extra > 0) {
    result.push({ deliveryId: null, quantity: extra, promisedDate: null });
  }
  return result;
}

/** Ens fordelinger? Bruges til at afgøre, om der skal skrives noget. */
export function sameAllocation(a: Bucket[], b: Bucket[]) {
  const key = (buckets: Bucket[]) =>
    buckets
      .filter((x) => x.quantity > 0)
      .map((x) => `${x.deliveryId ?? "-"}:${x.quantity}`)
      .sort()
      .join("|");
  return key(a) === key(b);
}
