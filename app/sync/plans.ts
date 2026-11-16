// Hvordan en leverances selling plan SKAL se ud i Shopify, og om en
// eksisterende plan stemmer med det. Rene funktioner uden Shopify-kald.

/** Det, synkroniseringen ønsker oprettet for én leverance. */
export type DesiredPlan = {
  deliveryId: string;
  /**
   * Planens navn, som temaet viser i kurven og Shopify i checkout. Uden dato:
   * datoen står i linjeegenskaben (se app-blokken), som følger med på
   * ordren. Stod den også her, stod datoen to gange i kurven.
   */
  name: string;
  /**
   * Unik inden for gruppen, fx "Forventet afsendelse: 7. november 2026".
   * Bruges også til at genkende nyoprettede planer.
   */
  option: string;
  /** Leverancens dato som tidspunkt, se fulfillmentTime(). */
  fulfillmentExactTime: string;
  /** Navn og valg på butikkens øvrige sprog (Shopifys oversættelser). */
  translations?: PlanTranslation[];
};

/** Én oversættelse: locale er butikkens sprogkode, fx "en" eller "da". */
export type PlanTranslation = {
  locale: string;
  name: string;
  option?: string;
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

/**
 * Planernes tekster på de sprog, appen kan. Planerne oprettes på butikkens
 * hovedsprog, og de andre sprog lægges på som Shopify-oversættelser, så
 * kunden ser sit eget sprog i kurv, checkout og ordrebekræftelse. Andre sprog
 * end disse får hovedsprogets tekst (Shopifys standard).
 *
 * Navnene bruges også af kurvens app embed til at genkende PREAURAs planer
 * (theme-extension-src/preaura-cart.js) — en test holder dem ens.
 */
export const PLAN_LANGUAGES = {
  da: {
    planName: "Forudbestilling",
    groupName: "Forudbestilling",
    groupOption: "Leverance",
    shipping: "Forventet afsendelse: {date}",
    delivery: "Forventet levering: {date}",
    nth: "leverance {n}",
    dateLocale: "da-DK",
  },
  en: {
    planName: "Pre-order",
    groupName: "Pre-order",
    groupOption: "Delivery",
    shipping: "Expected to ship: {date}",
    delivery: "Expected delivery: {date}",
    nth: "delivery {n}",
    dateLocale: "en-US",
  },
} as const;

export type PlanLanguage = keyof typeof PLAN_LANGUAGES;

/** Butikkens sprogkode → appens sprog. Ukendt: dansk, som før. */
export function planLanguage(locale: string | null | undefined): PlanLanguage {
  if (!locale) return "da";
  const base = locale.toLowerCase().split("-")[0];
  return base in PLAN_LANGUAGES ? (base as PlanLanguage) : "en";
}

/** Hovedsprog og de øvrige udgivne sprog, appen har tekster til. */
export type PlanLocales = {
  primary: PlanLanguage;
  /** Butikkens sprogkode og appens sprog for hvert øvrigt sprog. */
  others: { locale: string; language: PlanLanguage }[];
};

export const DEFAULT_PLAN_LOCALES: PlanLocales = { primary: "da", others: [] };

/** Ud fra Shopifys shopLocales. */
export function planLocales(
  locales: { locale: string; primary: boolean; published: boolean }[],
): PlanLocales {
  const primaryLocale = locales.find((l) => l.primary)?.locale;
  if (!primaryLocale) return DEFAULT_PLAN_LOCALES;
  const primary = planLanguage(primaryLocale);
  const others = locales
    .filter((l) => !l.primary && l.published)
    .filter((l) => {
      const base = l.locale.toLowerCase().split("-")[0];
      return base in PLAN_LANGUAGES && base !== primary;
    })
    .map((l) => ({ locale: l.locale, language: planLanguage(l.locale) }));
  return { primary, others };
}

// Bagudkompatible navne (dansk).
export const GROUP_NAME = PLAN_LANGUAGES.da.groupName;
/** Hver plans navn. Datoen står i linjeegenskaben, ikke her. */
export const PLAN_NAME = PLAN_LANGUAGES.da.planName;
export const GROUP_OPTION = PLAN_LANGUAGES.da.groupOption;

/** Gruppens navn og valg på hovedsproget og oversættelserne. */
export function groupTexts(locales: PlanLocales) {
  const t = PLAN_LANGUAGES[locales.primary];
  return {
    name: t.groupName,
    option: t.groupOption,
    translations: locales.others.map(({ locale, language }) => ({
      locale,
      name: PLAN_LANGUAGES[language].groupName,
      option: PLAN_LANGUAGES[language].groupOption,
    })),
  };
}

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

function formatPlanDate(date: string, language: PlanLanguage) {
  return new Intl.DateTimeFormat(PLAN_LANGUAGES[language].dateLocale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(fulfillmentTime(date)));
}

/**
 * Butikkens tekst i appens indstillinger. Står den til en af standardteksterne
 * (fx databasens «Forventet afsendelse: {dato}»), bruges sprogets egen tekst,
 * så en engelsk butik ikke får dansk. En egen tekst bruges på hovedsproget.
 */
const STANDARD_TEMPLATES = new Set<string>([
  "Forventet afsendelse: {dato}",
  "Forventet levering: {dato}",
  ...Object.values(PLAN_LANGUAGES).flatMap((t) => [t.shipping, t.delivery]),
]);

/** Er teksten en af standardteksterne (på et af sprogene)? */
export function isStandardDateText(text: string) {
  return STANDARD_TEMPLATES.has(text);
}

function fillDate(template: string, date: string) {
  return template.replaceAll("{dato}", date).replaceAll("{date}", date);
}

export type PlanTexts = {
  dateMode: string;
  shippingDateText: string;
  deliveryDateText: string;
};

/**
 * Ønskede planer for leverancerne. Kun åbne leverancer får en plan; en
 * annulleret leverance tages ud af brug.
 */
/**
 * Planens navn. Shopify kræver, at planerne i en gruppe har hvert sit navn
 * (fundet i testbutikken: «Cannot have multiple selling plans with the same
 * name»). Leverance 1 hedder bare «Forudbestilling», de næste får deres
 * nummer på: «Forudbestilling (leverance 2)». Leverancens nummer er fast og
 * unikt for varianten, så navnet er det også. Datoen står i linjeegenskaben.
 */
export function planName(language: PlanLanguage, position: number) {
  const t = PLAN_LANGUAGES[language];
  return position <= 1
    ? t.planName
    : `${t.planName} (${t.nth.replace("{n}", String(position))})`;
}

export function desiredPlans(
  deliveries: { id: string; position: number; date: string; status: string }[],
  texts: PlanTexts,
  locales: PlanLocales = DEFAULT_PLAN_LOCALES,
): DesiredPlan[] {
  const delivery = texts.dateMode === "DELIVERY";
  const own = delivery ? texts.deliveryDateText : texts.shippingDateText;
  const standard = STANDARD_TEMPLATES.has(own);
  const template = (language: PlanLanguage) =>
    standard
      ? PLAN_LANGUAGES[language][delivery ? "delivery" : "shipping"]
      : own;
  const open = deliveries
    .filter((d) => d.status === "OPEN")
    .sort((a, b) => a.position - b.position);

  // To leverancer på samme dato skal stadig kunne skelnes i gruppen.
  const labels = (language: PlanLanguage, withOwn: boolean) => {
    const seen = new Set<string>();
    return open.map((d) => {
      const label = fillDate(
        withOwn
          ? template(language)
          : PLAN_LANGUAGES[language][delivery ? "delivery" : "shipping"],
        formatPlanDate(d.date, language),
      );
      let option = label;
      if (seen.has(option)) {
        option = `${label} (${PLAN_LANGUAGES[language].nth.replace("{n}", String(d.position))})`;
      }
      seen.add(option);
      return option;
    });
  };

  const primary = labels(locales.primary, true);
  // Har butikken sin egen tekst, oversættes kun navnet: appen kan ikke
  // oversætte butikkens egen formulering.
  const other = locales.others.map((o) => ({
    ...o,
    options: standard ? labels(o.language, false) : null,
  }));
  return open.map((d, i) => ({
    deliveryId: d.id,
    name: planName(locales.primary, d.position),
    option: primary[i],
    fulfillmentExactTime: fulfillmentTime(d.date),
    translations: other.map((o) => ({
      locale: o.locale,
      name: planName(o.language, d.position),
      ...(o.options ? { option: o.options[i] } : {}),
    })),
  }));
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
