import { describe, expect, it } from "vitest";
import { UNSAFE_ErrorResponseImpl as ErrorResponse } from "react-router";
import {
  subscriptionRequired,
  subscriptionRequiredFrom,
} from "./subscriptionRequired";

// Uden abonnement kastes et 402-svar med prisvalgssidens adresse, som
// layoutets ErrorBoundary viser som «Vælg abonnement» — ikke et tomt
// 200-svar, som gav et glimt af «200».

const URL =
  "https://admin.shopify.com/store/butik/charges/preaura/pricing_plans";

describe("vælg abonnement", () => {
  it("svaret er 402 med adressen — aldrig 200", () => {
    const thrown = subscriptionRequired(URL);
    expect(thrown.init?.status).toBe(402);
    expect(thrown.data).toMatchObject({
      reason: "subscription_required",
      pricingUrl: URL,
    });
  });

  it("ErrorBoundary genkender svaret, som React Router leverer det", () => {
    const thrown = subscriptionRequired(URL);
    const error = new ErrorResponse(402, "", thrown.data);
    expect(subscriptionRequiredFrom(error)).toMatchObject({ pricingUrl: URL });
  });

  it("andre fejl går videre til Shopifys egen håndtering", () => {
    expect(subscriptionRequiredFrom(new Error("x"))).toBeNull();
    expect(
      subscriptionRequiredFrom(new ErrorResponse(404, "", "Ikke fundet")),
    ).toBeNull();
    expect(
      subscriptionRequiredFrom(
        new ErrorResponse(402, "", { reason: "andet", pricingUrl: URL }),
      ),
    ).toBeNull();
  });
});
