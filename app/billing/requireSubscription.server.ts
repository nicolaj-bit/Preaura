import { authenticate } from "../shopify.server";
import { accessFor, pricingPageUrl } from "./access.server";

/**
 * Adgangskontrollen for en funktion. Bruges i stedet for
 * authenticate.admin(request) i funktionens loader og action:
 *
 *   const { admin, session } = await requireSubscription(request);
 *
 * Har butikken et aktivt abonnement (også i prøveperioden), returneres den
 * godkendte admin-kontekst. Ellers sendes butikken til Shopifys
 * prisvalgsside, uden for app-rammen. Rører aldrig data.
 */
export async function requireSubscription(request: Request) {
  const context = await authenticate.admin(request);
  const access = await accessFor(context.admin, context.session.shop);
  if (access.status === "none") {
    throw context.redirect(pricingPageUrl(context.session.shop), {
      target: "_top",
    });
  }
  return context;
}
