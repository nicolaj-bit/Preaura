import { data, isRouteErrorResponse } from "react-router";

// Når butikken ikke har et aktivt abonnement, skal den til Shopifys
// prisvalgsside. Før brugte appen Shopify-bibliotekets redirect med target
// "_top". Inde i app-rammen svarer biblioteket med en tom side (status 200),
// som React Router viser som en fejlside — derfor glimtede «200», før
// prisvalgssiden kom frem.
//
// Nu kaster loaderen og actionen i stedet et 402-svar med adressen.
// Layoutets ErrorBoundary viser en rigtig side («Vælg abonnement») og sender
// selv butikken videre (SubscriptionRequired i app/routes/app.tsx).

const STATUS = 402;

export type SubscriptionRequiredData = {
  reason: "subscription_required";
  pricingUrl: string;
  apiKey: string;
};

export function subscriptionRequired(pricingUrl: string) {
  const body: SubscriptionRequiredData = {
    reason: "subscription_required",
    pricingUrl,
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
  return data(body, { status: STATUS });
}

/** Er fejlen fra ErrorBoundary et «vælg abonnement»-svar? Så adressen. */
export function subscriptionRequiredFrom(
  error: unknown,
): SubscriptionRequiredData | null {
  if (!isRouteErrorResponse(error) || error.status !== STATUS) return null;
  const body = error.data as Partial<SubscriptionRequiredData> | null;
  if (body?.reason !== "subscription_required" || !body.pricingUrl) {
    return null;
  }
  return {
    reason: "subscription_required",
    pricingUrl: body.pricingUrl,
    apiKey: body.apiKey ?? "",
  };
}
