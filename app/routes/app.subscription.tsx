import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  accessFor,
  billingEnabled,
  pricingPageUrl,
} from "../billing/entitlements.server";
import { loadPlansConfig } from "../billing/plans";
import { subscriptionView } from "../billing/view";
import { fetchShopTimeZone } from "../lib/shopifyProducts.server";

// Abonnement: hvilken plan butikken har, hvad den giver adgang til, og en
// knap til Shopifys prisvalgsside. Priserne vises kun hos Shopify.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const access = await accessFor(admin, session.shop);
  const view = subscriptionView(access, loadPlansConfig(), billingEnabled());
  const timeZone = await fetchShopTimeZone(admin.graphql);
  const format = new Intl.DateTimeFormat("da-DK", {
    dateStyle: "long",
    timeZone,
  });
  return {
    view,
    trialEnds:
      view.kind === "active" && view.trialEndsAt
        ? format.format(new Date(view.trialEndsAt))
        : null,
    pricingUrl: view.kind === "off" ? null : pricingPageUrl(session.shop),
  };
};

export default function SubscriptionPage() {
  const { view, trialEnds, pricingUrl } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Abonnement">
      {pricingUrl && (
        <s-button
          slot="primary-action"
          variant="primary"
          href={pricingUrl}
          target="_top"
        >
          Skift abonnement
        </s-button>
      )}

      {view.kind === "off" && (
        <s-section>
          <s-paragraph>
            Abonnementer er ikke slået til endnu. Alle funktioner er
            tilgængelige.
          </s-paragraph>
        </s-section>
      )}

      {view.kind === "none" && (
        <s-section>
          <s-paragraph>
            Butikken har intet aktivt abonnement. Vælg en plan for at bruge
            PREAURA.
          </s-paragraph>
        </s-section>
      )}

      {view.kind === "active" && (
        <>
          <s-section heading="Din plan">
            <s-stack gap="base">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-heading>{view.planLabel}</s-heading>
                <s-badge tone="success">Aktiv</s-badge>
              </s-stack>
              {view.endsAtPeriodEnd && (
                <s-banner tone="warning">
                  <s-paragraph>
                    Abonnementet stopper ved udgangen af den nuværende periode.
                    Dine leverancer og ordrer bliver liggende, også hvis du
                    vælger en mindre plan.
                  </s-paragraph>
                </s-banner>
              )}
              {trialEnds && (
                <s-paragraph>Prøveperioden slutter {trialEnds}.</s-paragraph>
              )}
              <s-paragraph>
                Vil du skifte plan eller se priserne, så klik «Skift
                abonnement». Det sker hos Shopify, og betalingen kører over
                butikkens Shopify-faktura.
              </s-paragraph>
            </s-stack>
          </s-section>

          <s-section heading="Det får du">
            <s-unordered-list>
              {view.included.map((label) => (
                <s-list-item key={label}>{label}</s-list-item>
              ))}
            </s-unordered-list>
            {view.notIncluded.length > 0 && (
              <s-stack gap="small-200">
                <s-text color="subdued">Ikke med i din plan:</s-text>
                <s-unordered-list>
                  {view.notIncluded.map((label) => (
                    <s-list-item key={label}>{label}</s-list-item>
                  ))}
                </s-unordered-list>
              </s-stack>
            )}
          </s-section>

          <s-section heading="Skifter du plan">
            <s-paragraph>
              Dine leverancer, forudbestillinger og ordrer slettes aldrig, når
              du skifter til en mindre plan eller opsiger. Kun funktionerne
              lukkes, og løfterne til dine kunder holdes. Skifter du tilbage, er
              alt, som det var.
            </s-paragraph>
          </s-section>
        </>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
