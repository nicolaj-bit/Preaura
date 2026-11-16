import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect } from "react";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import {
  accessFor,
  clearAccessCache,
  pricingPageUrl,
} from "../billing/access.server";
import { PartnerApiError } from "../billing/partnerApi.server";
import {
  subscriptionRequired,
  subscriptionRequiredFrom,
} from "../billing/subscriptionRequired";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Kommer butikken tilbage fra Shopifys prisvalgsside, sætter Shopify
  // plan_handle i adressen. Den bruges kun som signal om at tømme cachen —
  // adgangen læses altid fra Shopify, aldrig fra adressen.
  if (new URL(request.url).searchParams.has("plan_handle")) {
    clearAccessCache(session.shop);
  }

  // Intet aktivt abonnement (prøveperioden er udløbet, eller abonnementet er
  // opsagt): hele appen lukkes, og butikken sendes til Shopifys
  // prisvalgsside — via ErrorBoundary nedenfor, så der ikke glimter en tom
  // side. Intet data røres.
  // eslint-disable-next-line no-undef
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  let access;
  try {
    access = await accessFor(admin, session.shop);
  } catch (error) {
    // Abonnementet kunne ikke tjekkes. Butikken sendes IKKE til
    // prisvalgssiden; i stedet vises årsagen (uden hemmeligheder).
    console.error(
      `Abonnementet for ${session.shop} kunne ikke tjekkes:`,
      error,
    );
    return {
      apiKey,
      billingError:
        error instanceof PartnerApiError
          ? error.message
          : "Abonnementet kunne ikke tjekkes. Prøv igen om lidt.",
    };
  }
  if (access.status === "none") {
    throw subscriptionRequired(pricingPageUrl(session.shop));
  }

  return { apiKey, billingError: null };
};

// Shopifys typer kender ikke rel på s-link, men s-app-nav læser det
// (https://shopify.dev/docs/api/app-home/app-bridge-web-components/app-nav).
const HOME_REL = { rel: "home" } as object;

export default function App() {
  const { apiKey, billingError } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        {/* Appens hjem: hvor et klik på appens navn i Shopify Admin fører
            hen. Vises ikke i menuen. Uden den bruger Shopify appens rod,
            som er startsiden for besøgende udefra. */}
        <s-link href="/app" {...HOME_REL}>
          PREAURA
        </s-link>
        <s-link href="/app">Produkter</s-link>
        <s-link href="/app/queue">Ordrebehandling</s-link>
        <s-link href="/app/releases">Annulleringer</s-link>
        <s-link href="/app/waitlist">Venteliste</s-link>
        <s-link href="/app/events">Hændelser</s-link>
        <s-link href="/app/settings">Indstillinger</s-link>
        <s-link href="/app/subscription">Abonnement</s-link>
      </s-app-nav>
      {billingError ? (
        <s-page heading="PREAURA">
          <s-banner tone="critical" heading="Abonnementet kunne ikke tjekkes">
            <s-paragraph>{billingError}</s-paragraph>
          </s-banner>
        </s-page>
      ) : (
        <Outlet />
      )}
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  const error = useRouteError();
  const required = subscriptionRequiredFrom(error);
  if (required) {
    return (
      <SubscriptionRequired
        apiKey={required.apiKey}
        pricingUrl={required.pricingUrl}
      />
    );
  }
  return boundary.error(error);
}

/**
 * Intet aktivt abonnement: en rigtig side i stedet for en tom, og butikken
 * sendes selv videre til Shopifys prisvalgsside uden for app-rammen.
 * Knappen er der, hvis browseren ikke sender videre af sig selv.
 */
function SubscriptionRequired({
  apiKey,
  pricingUrl,
}: {
  apiKey: string;
  pricingUrl: string;
}) {
  useEffect(() => {
    window.open(pricingUrl, "_top");
  }, [pricingUrl]);
  return (
    <AppProvider apiKey={apiKey}>
      <s-page heading="Vælg abonnement">
        <s-section>
          <s-paragraph>
            PREAURA kræver et aktivt abonnement. Du sendes nu videre til
            Shopifys side, hvor du vælger det. Dine leverancer og
            forudbestillinger er gemt og venter, til abonnementet er aktivt.
          </s-paragraph>
          <s-button variant="primary" href={pricingUrl} target="_top">
            Gå til abonnementet
          </s-button>
        </s-section>
      </s-page>
    </AppProvider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
