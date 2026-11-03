// Hvordan en leverances selling plan SKAL se ud i Shopify, og om en
// eksisterende plan stemmer med det. Rene funktioner uden Shopify-kald.

/** Det, synkroniseringen ønsker oprettet for én leverance. */
export type DesiredPlan = {
  deliveryId: string;
  /** Kundens tekst, fx "Forventet afsendelse: 7. november 2026". */
  name: string;
  /** Unik inden for gruppen. Bruges også til at genkende nyoprettede planer. */
  option: string;
  /** Leverancens dato som tidspunkt, se fulfillmentTime(). */
  fulfillmentExactTime: string;
};

/** En selling plan, som Shopify returnerer den. */
export type ShopifyPlan = {
  id: string;
  options: string[];
  category: string | null;
  reserve: string | null;
  billing: {
    remainingBalanceChargeTrigger: string;
    checkoutChargeType: string;
    checkoutChargePercentage: number | null;
  } | null;
  delivery: {
    fulfillmentTrigger: string;
    fulfillmentExactTime: string | null;
  } | null;
  pricingPolicyCount: number;
};

export const GROUP_NAME = "Forudbestilling";
export const GROUP_OPTION = "Leverance";

export function groupMerchantCode(variantId: string) {
  return `preaura-variant-${variantId.split("/").pop()}`;
}

/**
 * Leverancens dato som tidspunkt for Shopify. Kl. 12:00 UTC ligger på samme
 * kalenderdato i alle tidszoner fra UTC−11 til UTC+11, så datoen kan ikke
 * glide en dag i butikkens egen tidszone.
 */
export function fulfillmentTime(date: string) {
  return `${date}T12:00:00Z`;
}

const dateFormat = new Intl.DateTimeFormat("da-DK", {
  dateStyle: "long",
  timeZone: "UTC",
});

export type PlanTexts = {
  dateMode: string;
  shippingDateText: string;
  deliveryDateText: string;
};

/**
 * Ønskede planer for leverancerne. Kun åbne leverancer får en plan; en
 * annulleret leverance tages ud af brug.
 */
export function desiredPlans(
  deliveries: { id: string; position: number; date: string; status: string }[],
  texts: PlanTexts,
): DesiredPlan[] {
  const template =
    texts.dateMode === "DELIVERY"
      ? texts.deliveryDateText
      : texts.shippingDateText;
  const open = deliveries
    .filter((delivery) => delivery.status === "OPEN")
    .sort((a, b) => a.position - b.position);

  const seen = new Set<string>();
  return open.map((delivery) => {
    const formatted = dateFormat.format(
      new Date(fulfillmentTime(delivery.date)),
    );
    const name = template.replaceAll("{dato}", formatted);
    // To leverancer på samme dato skal stadig kunne skelnes i gruppen.
    let option = name;
    if (seen.has(option)) option = `${name} (leverance ${delivery.position})`;
    seen.add(option);
    return {
      deliveryId: delivery.id,
      name,
      option,
      fulfillmentExactTime: fulfillmentTime(delivery.date),
    };
  });
}

/** Input til Shopify for en ny plan. Alle reglerne for en plan står her. */
export function sellingPlanInput(plan: DesiredPlan) {
  return {
    name: plan.name,
    options: [plan.option],
    category: "PRE_ORDER",
    billingPolicy: {
      fixed: {
        // Intet ved bestilling. Hele beløbet trækkes, når ordren sendes
        // (fulfillment). Shopify gemmer kundens betalingsmiddel ved checkout.
        // Danske regler for kortbetaling: der må som udgangspunkt først
        // trækkes, når varen sendes.
        checkoutCharge: { type: "PERCENTAGE", value: { percentage: 0 } },
        remainingBalanceChargeTrigger: "ON_FULFILLMENT",
      },
    },
    deliveryPolicy: {
      fixed: {
        fulfillmentTrigger: "EXACT_TIME",
        fulfillmentExactTime: plan.fulfillmentExactTime,
      },
    },
    // Lageret bindes ved bestilling, ikke først ved forsendelse.
    inventoryPolicy: { reserve: "ON_SALE" },
  };
}

/**
 * Stemmer planen i Shopify med det, leverancen lover kunden? Navnet tæller
 * ikke med: det er en etiket, ikke en del af løftet, og planer ændres aldrig
 * bare fordi en tekst i indstillingerne er rettet.
 */
export function planMatches(plan: ShopifyPlan, desired: DesiredPlan) {
  return (
    plan.category === "PRE_ORDER" &&
    plan.reserve === "ON_SALE" &&
    plan.billing?.remainingBalanceChargeTrigger === "ON_FULFILLMENT" &&
    plan.billing.checkoutChargeType === "PERCENTAGE" &&
    plan.billing.checkoutChargePercentage === 0 &&
    plan.delivery?.fulfillmentTrigger === "EXACT_TIME" &&
    plan.delivery.fulfillmentExactTime != null &&
    Date.parse(plan.delivery.fulfillmentExactTime) ===
      Date.parse(desired.fulfillmentExactTime) &&
    plan.pricingPolicyCount === 0
  );
}
