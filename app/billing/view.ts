import type { Access } from "./entitlements.server";
import { FEATURES, type Feature, type PlansConfig } from "./plans";

// Det, siden «Abonnement» viser. Ren funktion — ingen priser (de står kun på
// Shopifys prisvalgsside), ingen database.

export const FEATURE_LABELS: Record<Feature, string> = {
  preorders: "Forudbestilling og leverancer",
  "events.flow": "Hændelser til Shopify Flow",
  "events.webhook": "Hændelser til webhook (Zapier, Make m.fl.)",
  "events.klaviyo": "Hændelser til Klaviyo",
};

export type SubscriptionView =
  | { kind: "off" }
  | { kind: "none" }
  | {
      kind: "active";
      planLabel: string;
      included: string[];
      notIncluded: string[];
      /** ISO-dato, hvis abonnementet slutter ved periodens udgang. */
      endsAtPeriodEnd: boolean;
      trialEndsAt: string | null;
    };

export function subscriptionView(
  access: Access,
  config: PlansConfig,
  billingOn: boolean,
): SubscriptionView {
  if (!billingOn) return { kind: "off" };
  if (access.status !== "active") return { kind: "none" };
  const plan = access.entitlement.plan;
  const label = (plan && config.plans[plan]?.label) ?? plan ?? "Ukendt plan";
  const has = new Set(access.entitlement.features);
  return {
    kind: "active",
    planLabel: label,
    included: FEATURES.filter((f) => has.has(f)).map((f) => FEATURE_LABELS[f]),
    notIncluded: FEATURES.filter((f) => !has.has(f)).map(
      (f) => FEATURE_LABELS[f],
    ),
    endsAtPeriodEnd: access.subscription?.cancelAtEndOfCycle ?? false,
    trialEndsAt: access.subscription?.trialEndsAt ?? null,
  };
}
