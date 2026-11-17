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
import { localeFor } from "../i18n/locale.server";
import { LocaleContext, translate, useT } from "../i18n";
import { logWarn } from "../lib/log.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await localeFor(request, session.shop);

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
    logWarn("Abonnementet kunne ikke tjekkes", { shop: session.shop }, error);
    return {
      apiKey,
      locale,
      billingError:
        error instanceof PartnerApiError
          ? error.message
          : translate(locale, "billing.errorGeneric"),
    };
  }
  if (access.status === "none") {
    throw subscriptionRequired(pricingPageUrl(session.shop), locale);
  }

  return { apiKey, locale, billingError: null };
};

// Shopifys typer kender ikke rel på s-link, men s-app-nav læser det
// (https://shopify.dev/docs/api/app-home/app-bridge-web-components/app-nav).
const HOME_REL = { rel: "home" } as object;

export default function App() {
  const { apiKey, locale, billingError } = useLoaderData<typeof loader>();

  return (
    <LocaleContext.Provider value={locale}>
      <AppProvider apiKey={apiKey}>
        <AppFrame billingError={billingError} />
      </AppProvider>
    </LocaleContext.Provider>
  );
}

function AppFrame({ billingError }: { billingError: string | null }) {
  const { t } = useT();
  return (
    <>
      <s-app-nav>
        {/* Appens hjem: hvor et klik på appens navn i Shopify Admin fører
            hen. Vises ikke i menuen. Uden den bruger Shopify appens rod,
            som er startsiden for besøgende udefra. */}
        <s-link href="/app" {...HOME_REL}>
          PREAURA
        </s-link>
        <s-link href="/app">{t("nav.products")}</s-link>
        <s-link href="/app/queue">{t("nav.queue")}</s-link>
        <s-link href="/app/releases">{t("nav.releases")}</s-link>
        <s-link href="/app/waitlist">{t("nav.waitlist")}</s-link>
        <s-link href="/app/events">{t("nav.events")}</s-link>
        <s-link href="/app/settings">{t("nav.settings")}</s-link>
        <s-link href="/app/subscription">{t("nav.subscription")}</s-link>
      </s-app-nav>
      {billingError ? (
        <s-page heading="PREAURA">
          <s-banner tone="critical" heading={t("billing.errorHeading")}>
            <s-paragraph>{billingError}</s-paragraph>
          </s-banner>
        </s-page>
      ) : (
        <Outlet />
      )}
    </>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  const error = useRouteError();
  const required = subscriptionRequiredFrom(error);
  if (required) {
    return (
      <LocaleContext.Provider value={required.locale}>
        <SubscriptionRequired
          apiKey={required.apiKey}
          pricingUrl={required.pricingUrl}
        />
      </LocaleContext.Provider>
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
  const { t } = useT();
  useEffect(() => {
    window.open(pricingUrl, "_top");
  }, [pricingUrl]);
  return (
    <AppProvider apiKey={apiKey}>
      <s-page heading={t("subscriptionRequired.heading")}>
        <s-section>
          <s-paragraph>{t("subscriptionRequired.text")}</s-paragraph>
          <s-button variant="primary" href={pricingUrl} target="_top">
            {t("subscriptionRequired.button")}
          </s-button>
        </s-section>
      </s-page>
    </AppProvider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
