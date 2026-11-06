import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, redirect } = await authenticate.admin(request);

  // Kommer butikken tilbage fra Shopifys prisvalgsside, sætter Shopify
  // plan_handle i adressen. Den bruges kun som signal om at tømme cachen —
  // adgangen læses altid fra Shopify, aldrig fra adressen.
  if (new URL(request.url).searchParams.has("plan_handle")) {
    clearAccessCache(session.shop);
  }

  // Intet aktivt abonnement (prøveperioden er udløbet, eller abonnementet er
  // opsagt): hele appen lukkes, og butikken sendes til Shopifys
  // prisvalgsside. target "_top" er nødvendig — siden ligger uden for
  // app-rammen (iframen). Intet data røres.
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
    throw redirect(pricingPageUrl(session.shop), { target: "_top" });
  }

  return { apiKey, billingError: null };
};

export default function App() {
  const { apiKey, billingError } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
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
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
