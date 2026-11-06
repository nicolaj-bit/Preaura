// Det, produktsiden henter efter sideindlæsning: den aktuelle leverance,
// hvor mange der er tilbage i den, og tidslinjen over leverancerne.
// Ren funktion — ingen database, intet netværk — så den kan testes.
//
// Tallet skal være sandt. Det er det mindste af to tal:
//   - appens eget regnskab (leverancens antal minus tildelinger), og
//   - Shopifys lager, som appen sætter til netop det tal, og som Shopify
//     tæller ned med det samme, når der købes — også før appen har nået at
//     behandle ordren.
// Et forkert, for højt «tilbage»-tal er vildledende over for forbrugeren.
// Derfor vises aldrig mere end det mindste af de to.
//
// Tidslinjen viser kun tilstand (udsolgt / aktuel / kommende), aldrig antal
// pr. kommende leverance, og den viser den aktuelle plan — ikke det, tidligere
// købere har fået lovet. Dem ændrer den intet ved.

export type LiveDelivery = {
  id: string;
  position: number;
  /** "YYYY-MM-DD" */
  date: string;
  status: string;
  remaining: number;
  sellingPlanId: string | null;
};

export type TimelineState = "SOLD_OUT" | "CURRENT" | "UPCOMING";

export type LiveVariant = {
  /** Leverancen, kunden køber ind i nu. Null: alt er udsolgt lige nu. */
  current: {
    date: string;
    sellingPlanId: string;
    /**
     * Tilbage i leverancen. Null, når Shopifys lager ikke kunne læses — så
     * kan tallet ikke bekræftes og vises ikke.
     */
    remaining: number | null;
  } | null;
  timeline: { date: string; state: TimelineState }[];
};

export function liveVariant(
  deliveries: LiveDelivery[],
  /** Shopifys lager for varianten lige nu. Null, hvis det ikke kunne læses. */
  shopifyAvailable: number | null,
  /** I dag, "YYYY-MM-DD". Udsolgte leverancer før i dag vises ikke. */
  today: string,
): LiveVariant {
  const open = deliveries
    .filter((d) => d.status === "OPEN")
    .sort((a, b) => a.position - b.position);
  const active = open.find((d) => d.remaining > 0) ?? null;

  let current: LiveVariant["current"] = null;
  if (active && active.sellingPlanId) {
    if (shopifyAvailable == null) {
      // Kan ikke bekræftes: leverancen vises, men intet tal.
      current = {
        date: active.date,
        sellingPlanId: active.sellingPlanId,
        remaining: null,
      };
    } else {
      const remaining = Math.min(active.remaining, shopifyAvailable);
      if (remaining > 0) {
        current = {
          date: active.date,
          sellingPlanId: active.sellingPlanId,
          remaining,
        };
      }
    }
  }

  const timeline: LiveVariant["timeline"] = [];
  for (const d of open) {
    let state: TimelineState;
    if (d.id === active?.id) {
      // Den aktuelle: kan købes, eller Shopify melder 0 (købt op, men endnu
      // ikke behandlet af appen), eller planen er ikke oprettet endnu.
      state = current
        ? "CURRENT"
        : active!.sellingPlanId
          ? "SOLD_OUT"
          : "UPCOMING";
    } else if (
      d.remaining <= 0 ||
      d.position < (active?.position ?? Infinity)
    ) {
      state = "SOLD_OUT";
    } else {
      state = "UPCOMING";
    }
    if (state === "SOLD_OUT" && d.date < today) continue;
    timeline.push({ date: d.date, state });
  }
  return { current, timeline };
}
