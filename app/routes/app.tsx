import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import {
  accessFor,
  clearEntitlementCache,
  pricingPageUrl,
} from "../billing/entitlements.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, redirect } = await authenticate.admin(request);

  // Kommer butikken tilbage fra Shopifys prisvalgsside, står plan_handle i
  // adressen. Den bruges kun som signal om at tømme cachen — adgangen læses
  // altid fra Shopify, aldrig fra adressen.
  if (new URL(request.url).searchParams.has("plan_handle")) {
    clearEntitlementCache(session.shop);
  }

  // Intet aktivt abonnement: til Shopifys prisvalgsside. target "_top" er
  // nødvendig — siden ligger uden for app-rammen (iframen).
  const access = await accessFor(admin, session.shop);
  if (access.status === "none") {
    throw redirect(pricingPageUrl(session.shop), { target: "_top" });
  }

  return {
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
    plan: access.entitlement.plan,
  };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Produkter</s-link>
        <s-link href="/app/queue">Ordrebehandling</s-link>
        <s-link href="/app/events">Hændelser</s-link>
        <s-link href="/app/settings">Indstillinger</s-link>
      </s-app-nav>
      <Outlet />
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
