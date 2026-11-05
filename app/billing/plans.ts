import defaultConfig from "../../config/plans.json";

// Planer og rettigheder. Ren kode uden database og netværk.
//
// Appen kender kun plannøgler (gratis, basis, pro) — aldrig priser eller
// plannavne. Hvad hver plan giver adgang til, står i config/plans.json og kan
// overstyres med miljøvariablen PREAURA_PLANS_JSON uden at røre koden.
//
// VIGTIGT: Planer styrer kun ADGANG til funktioner. Intet her (eller i
// app/billing/ i øvrigt) må læse fra eller skrive til databasen. En
// nedgradering eller opsigelse lukker funktioner — den sletter aldrig
// leverancer, tildelinger eller ordredata. Det håndhæves af lint og test.

/** Funktioner, der kan gøres planafhængige. Tilføj nye her. */
export const FEATURES = [
  "preorders",
  "events.flow",
  "events.webhook",
  "events.klaviyo",
] as const;
export type Feature = (typeof FEATURES)[number];

/** Talgrænser pr. plan. null = ingen grænse. */
export const LIMITS = ["preorderVariants"] as const;
export type Limit = (typeof LIMITS)[number];

export type PlanKey = string;

export type PlanDefinition = {
  /** Navnet, butikken ser i appen, fx «Basis». */
  label: string;
  features: Feature[];
  limits: Record<Limit, number | null>;
};

export type PlansConfig = {
  plans: Record<PlanKey, PlanDefinition>;
  /** Plan-handle i Shopify App Pricing → appens plannøgle. */
  shopifyHandles: Record<string, PlanKey>;
  /**
   * Plannøglen, en butik får, hvis Shopify melder en handle, der ikke står i
   * shopifyHandles. Til fordel for butikken: ingen, der betaler, får mindre.
   */
  unknownHandlePlan: PlanKey;
};

export class PlansConfigError extends Error {
  constructor(message: string) {
    super(`Ugyldig plankonfiguration: ${message}`);
    this.name = "PlansConfigError";
  }
}

/** Læser og kontrollerer konfigurationen. Kaster ved fejl. */
export function parsePlansConfig(input: unknown): PlansConfig {
  if (!input || typeof input !== "object") {
    throw new PlansConfigError("forventede et objekt.");
  }
  const raw = input as Record<string, unknown>;
  const plansRaw = raw.plans as Record<string, unknown> | undefined;
  if (!plansRaw || typeof plansRaw !== "object") {
    throw new PlansConfigError("«plans» mangler.");
  }
  const plans: Record<PlanKey, PlanDefinition> = {};
  for (const [key, value] of Object.entries(plansRaw)) {
    const plan = value as {
      label?: unknown;
      features?: unknown;
      limits?: unknown;
    };
    if (!Array.isArray(plan?.features)) {
      throw new PlansConfigError(`planen «${key}» mangler «features».`);
    }
    for (const feature of plan.features) {
      if (!(FEATURES as readonly string[]).includes(feature as string)) {
        throw new PlansConfigError(
          `planen «${key}» har en ukendt funktion «${String(feature)}».`,
        );
      }
    }
    const limitsRaw = (plan.limits ?? {}) as Record<string, unknown>;
    const limits = {} as Record<Limit, number | null>;
    for (const limit of LIMITS) {
      const v = limitsRaw[limit];
      if (v != null && (typeof v !== "number" || v < 0)) {
        throw new PlansConfigError(
          `grænsen «${limit}» i planen «${key}» skal være et tal eller null.`,
        );
      }
      limits[limit] = (v as number | null | undefined) ?? null;
    }
    plans[key] = {
      label:
        typeof plan.label === "string" && plan.label
          ? plan.label
          : key.charAt(0).toUpperCase() + key.slice(1),
      features: plan.features as Feature[],
      limits,
    };
  }
  const handles = (raw.shopifyHandles ?? {}) as Record<string, unknown>;
  const shopifyHandles: Record<string, PlanKey> = {};
  for (const [handle, key] of Object.entries(handles)) {
    if (typeof key !== "string" || !plans[key]) {
      throw new PlansConfigError(
        `handle «${handle}» peger på en ukendt plan «${String(key)}».`,
      );
    }
    shopifyHandles[handle] = key;
  }
  const unknownHandlePlan = raw.unknownHandlePlan;
  if (typeof unknownHandlePlan !== "string" || !plans[unknownHandlePlan]) {
    throw new PlansConfigError("«unknownHandlePlan» skal være en kendt plan.");
  }
  return { plans, shopifyHandles, unknownHandlePlan };
}

/** Konfigurationen: PREAURA_PLANS_JSON, hvis den er sat, ellers filen. */
export function loadPlansConfig(
  env: Record<string, string | undefined> = process.env,
): PlansConfig {
  const override = env.PREAURA_PLANS_JSON;
  if (override) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(override);
    } catch {
      throw new PlansConfigError("PREAURA_PLANS_JSON er ikke gyldig JSON.");
    }
    return parsePlansConfig(parsed);
  }
  return parsePlansConfig(defaultConfig);
}

/** Plannøglen ud fra de handles, Shopify melder for abonnementet. */
export function planForHandles(
  config: PlansConfig,
  handles: string[],
): PlanKey {
  for (const handle of handles) {
    const key = config.shopifyHandles[handle];
    if (key) return key;
  }
  return config.unknownHandlePlan;
}

export type Entitlement = {
  /** Plannøglen, eller null når abonnementstjekket er slået fra. */
  plan: PlanKey | null;
  features: Feature[];
  limits: Record<Limit, number | null>;
};

export function entitlementFor(
  config: PlansConfig,
  plan: PlanKey,
): Entitlement {
  const definition = config.plans[plan];
  return {
    plan,
    features: [...definition.features],
    limits: { ...definition.limits },
  };
}

/** Alle funktioner, ingen grænser — når abonnementstjekket er slået fra. */
export function unrestricted(): Entitlement {
  return {
    plan: null,
    features: [...FEATURES],
    limits: Object.fromEntries(LIMITS.map((l) => [l, null])) as Record<
      Limit,
      number | null
    >,
  };
}

/** Har planen adgang til funktionen? */
export function can(entitlement: Entitlement, feature: Feature) {
  return entitlement.features.includes(feature);
}

/** Planens grænse (null = ingen grænse). */
export function limitOf(entitlement: Entitlement, limit: Limit) {
  return entitlement.limits[limit];
}
