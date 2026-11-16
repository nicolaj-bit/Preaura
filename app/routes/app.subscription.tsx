import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  accessFor,
  billingEnabled,
  pricingPageUrl,
  subscriptionStatus,
} from "../billing/access.server";
import { fetchShopTimeZone } from "../lib/shopifyProducts.server";
import { formatDate, useT } from "../i18n";
import { localeFor } from "../i18n/locale.server";

// Abonnement: om butikken er i prøveperiode (og hvor længe endnu), om
// abonnementet er aktivt, og en vej videre til Shopifys prisvalgsside.
// Ingen planvælger og ingen priser — de står kun hos Shopify.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const access = await accessFor(admin, session.shop);
  const status = subscriptionStatus(access, billingEnabled());
  const locale = await localeFor(request, session.shop);
  let trialEnds: string | null = null;
  if (status.kind === "trial") {
    const timeZone = await fetchShopTimeZone(admin.graphql);
    trialEnds = formatDate(locale, status.trialEndsAt, timeZone);
  }
  return {
    status,
    trialEnds,
    pricingUrl: status.kind === "off" ? null : pricingPageUrl(session.shop),
  };
};

export default function SubscriptionPage() {
  const { status, trialEnds, pricingUrl } = useLoaderData<typeof loader>();
  const { t } = useT();
  const endsAtPeriodEnd =
    (status.kind === "trial" || status.kind === "active") &&
    status.endsAtPeriodEnd;

  return (
    <s-page heading={t("subscription.heading")}>
      {status.kind === "off" && (
        <s-section>
          <s-paragraph>{t("subscription.off")}</s-paragraph>
        </s-section>
      )}

      {status.kind === "none" && (
        <s-section>
          <s-stack gap="base">
            <s-banner tone="warning">
              <s-paragraph>{t("subscription.none")}</s-paragraph>
            </s-banner>
            {pricingUrl && (
              <s-button variant="primary" href={pricingUrl} target="_top">
                {t("subscription.start")}
              </s-button>
            )}
          </s-stack>
        </s-section>
      )}

      {(status.kind === "trial" || status.kind === "active") && (
        <s-section heading="PREAURA">
          <s-stack gap="base">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              {status.kind === "trial" ? (
                <s-badge tone="info">{t("subscription.badge.trial")}</s-badge>
              ) : (
                <s-badge tone="success">
                  {t("subscription.badge.active")}
                </s-badge>
              )}
            </s-stack>

            {status.kind === "trial" && (
              <s-paragraph>
                {status.daysLeft === 1
                  ? t("subscription.lastDay")
                  : t("subscription.daysLeft", { count: status.daysLeft })}
                {trialEnds
                  ? t("subscription.endsOn", { date: trialEnds })
                  : "."}
              </s-paragraph>
            )}

            {endsAtPeriodEnd && (
              <s-banner tone="warning">
                <s-paragraph>{t("subscription.cancelled")}</s-paragraph>
              </s-banner>
            )}

            <s-paragraph>{t("subscription.about")}</s-paragraph>

            {pricingUrl && (
              <s-stack direction="inline">
                <s-button href={pricingUrl} target="_top">
                  {t("subscription.seeAtShopify")}
                </s-button>
              </s-stack>
            )}
          </s-stack>
        </s-section>
      )}

      <s-section heading={t("subscription.ifStops.heading")}>
        <s-paragraph>{t("subscription.ifStops.text")}</s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
