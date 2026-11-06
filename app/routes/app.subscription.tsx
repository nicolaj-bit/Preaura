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

// Abonnement: om butikken er i prøveperiode (og hvor længe endnu), om
// abonnementet er aktivt, og en vej videre til Shopifys prisvalgsside.
// Ingen planvælger og ingen priser — de står kun hos Shopify.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const access = await accessFor(admin, session.shop);
  const status = subscriptionStatus(access, billingEnabled());
  let trialEnds: string | null = null;
  if (status.kind === "trial") {
    const timeZone = await fetchShopTimeZone(admin.graphql);
    trialEnds = new Intl.DateTimeFormat("da-DK", {
      dateStyle: "long",
      timeZone,
    }).format(new Date(status.trialEndsAt));
  }
  return {
    status,
    trialEnds,
    pricingUrl: status.kind === "off" ? null : pricingPageUrl(session.shop),
  };
};

export default function SubscriptionPage() {
  const { status, trialEnds, pricingUrl } = useLoaderData<typeof loader>();
  const endsAtPeriodEnd =
    (status.kind === "trial" || status.kind === "active") &&
    status.endsAtPeriodEnd;

  return (
    <s-page heading="Abonnement">
      {status.kind === "off" && (
        <s-section>
          <s-paragraph>
            Abonnementet er ikke slået til endnu. Alle funktioner er
            tilgængelige.
          </s-paragraph>
        </s-section>
      )}

      {status.kind === "none" && (
        <s-section>
          <s-stack gap="base">
            <s-banner tone="warning">
              <s-paragraph>
                Butikken har intet aktivt abonnement, så PREAURA er lukket. Dine
                leverancer og forudbestillinger er gemt og venter på dig.
              </s-paragraph>
            </s-banner>
            {pricingUrl && (
              <s-button variant="primary" href={pricingUrl} target="_top">
                Start abonnement
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
                <s-badge tone="info">Prøveperiode</s-badge>
              ) : (
                <s-badge tone="success">Aktiv</s-badge>
              )}
            </s-stack>

            {status.kind === "trial" && (
              <s-paragraph>
                {status.daysLeft === 1
                  ? "Sidste dag af prøveperioden"
                  : `${status.daysLeft} dage tilbage af prøveperioden`}
                {trialEnds ? ` (slutter ${trialEnds}).` : "."}
              </s-paragraph>
            )}

            {endsAtPeriodEnd && (
              <s-banner tone="warning">
                <s-paragraph>
                  Abonnementet er opsagt og stopper ved udgangen af den
                  nuværende periode. Dine leverancer og forudbestillinger
                  slettes ikke.
                </s-paragraph>
              </s-banner>
            )}

            <s-paragraph>
              Abonnementet giver adgang til alle PREAURAs funktioner. Det styres
              hos Shopify, og betalingen kører over butikkens Shopify-faktura.
            </s-paragraph>

            {pricingUrl && (
              <s-stack direction="inline">
                <s-button href={pricingUrl} target="_top">
                  Se abonnementet hos Shopify
                </s-button>
              </s-stack>
            )}
          </s-stack>
        </s-section>
      )}

      <s-section heading="Hvis abonnementet stopper">
        <s-paragraph>
          Udløber prøveperioden uden abonnement, eller opsiger du, lukkes appens
          funktioner. Leverancer, forudbestillinger og ordrer slettes aldrig.
          Starter du abonnementet igen, er alt, som det var.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
