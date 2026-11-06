import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireSubscription } from "../billing/requireSubscription.server";
import { waitlistFor } from "../models/waitlist.server";
import { outboxFor } from "../models/outbox.server";
import { fetchVariantNames, numericId } from "../lib/shopifyProducts.server";
import {
  parseWaitlistSettings,
  waitlistRows,
  WAITLIST_SETTING_LIMITS,
} from "../waitlist/view";

// Venteliste: hvor mange der venter på besked pr. variant, hvor mange der
// har fået besked pr. leverance, og hvordan beskederne fordeles.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await requireSubscription(request);
  const waitlist = waitlistFor(session.shop);
  const [overview, settings, recipients] = await Promise.all([
    waitlist.overview(),
    waitlist.settings(),
    outboxFor(session.shop).integrations.secrets(),
  ]);
  const variantIds = [
    ...new Set([
      ...overview.waiting.map((w) => w.variantId),
      ...overview.notified.map((n) => n.variantId),
    ]),
  ];
  const names = await fetchVariantNames(admin.graphql, variantIds);
  const format = new Intl.DateTimeFormat("da-DK", {
    dateStyle: "long",
    timeZone: "UTC",
  });
  const rows = waitlistRows(overview.waiting, overview.notified, names).map(
    (row) => ({
      ...row,
      productNumber: numericId(row.productId),
      notified: row.notified.map((n) => ({
        label: n.deliveryDate
          ? `Leverance ${format.format(new Date(`${n.deliveryDate}T12:00:00Z`))}`
          : "På lager",
        count: n.count,
      })),
    }),
  );
  return {
    rows,
    totalWaiting: rows.reduce((sum, r) => sum + r.waiting, 0),
    settings,
    hasRecipients: Boolean(
      recipients.flow || recipients.webhook || recipients.klaviyo,
    ),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await requireSubscription(request);
  const form = await request.formData();
  const parsed = parseWaitlistSettings({
    stableMinutes: form.get("stableMinutes"),
    batchSize: form.get("batchSize"),
    batchMinutes: form.get("batchMinutes"),
  });
  if (!parsed.ok) return parsed;
  await waitlistFor(session.shop).updateSettings(parsed.values);
  return { ok: true as const };
};

export default function WaitlistPage() {
  const { rows, totalWaiting, settings, hasRecipients } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [values, setValues] = useState({
    stableMinutes: String(settings.stableMinutes),
    batchSize: String(settings.batchSize),
    batchMinutes: String(settings.batchMinutes),
  });
  const errors = fetcher.data && !fetcher.data.ok ? fetcher.data.errors : {};
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Indstillinger gemt");
  }, [fetcher.data, shopify]);

  const set = (field: keyof typeof values) => (event: Event) =>
    setValues((current) => ({
      ...current,
      [field]: (event.currentTarget as HTMLInputElement).value,
    }));

  return (
    <s-page heading="Venteliste">
      {!hasRecipients && (
        <s-banner tone="warning" heading="Ingen modtagere er slået til">
          <s-paragraph>
            Tilmeldinger samles, men der udløses ingen beskeder, før mindst én
            modtager er slået til under{" "}
            <s-link href="/app/events">Hændelser</s-link>.
          </s-paragraph>
        </s-banner>
      )}

      <s-section heading={`Venter på besked (${totalWaiting})`}>
        {rows.length === 0 ? (
          <s-paragraph>
            Ingen har skrevet sig op endnu. Feltet vises på produktsiden, når en
            variant hverken kan købes på lager eller forudbestilles — slå det
            til i blokken «Forudbestilling» i temaeditoren.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Produkt</s-table-header>
              <s-table-header>Variant</s-table-header>
              <s-table-header format="numeric">Venter nu</s-table-header>
              <s-table-header listSlot="secondary">
                Har fået besked
              </s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((row) => (
                <s-table-row key={row.variantId}>
                  <s-table-cell>
                    <s-link href={`/app/products/${row.productNumber}`}>
                      {row.productTitle}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{row.variantTitle}</s-table-cell>
                  <s-table-cell>{row.waiting}</s-table-cell>
                  <s-table-cell>
                    {row.notified.length === 0
                      ? "–"
                      : row.notified
                          .map((n) => `${n.label}: ${n.count}`)
                          .join(" · ")}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Sådan sendes beskederne">
        <s-stack gap="base">
          <s-paragraph>
            Når en variant kan købes igen — fordi den er kommet på lager, eller
            fordi en leverance med ledige pladser er åbnet — får de tilmeldte
            besked i den rækkefølge, de skrev sig op. Hver tilmelding får én
            besked og lukkes derefter. Selve beskeden sender du via Shopify Flow
            eller Klaviyo.
          </s-paragraph>
          <s-number-field
            label="Ventetid (minutter)"
            details="Varen skal have kunnet købes så længe, før der sendes. Så giver et kort udsving i lageret ingen beskeder."
            value={values.stableMinutes}
            min={WAITLIST_SETTING_LIMITS.stableMinutes.min}
            max={WAITLIST_SETTING_LIMITS.stableMinutes.max}
            error={errors.stableMinutes}
            onChange={set("stableMinutes")}
          />
          <s-number-field
            label="Portion (antal pr. gang)"
            details="Så mange får besked ad gangen. Sæt den gerne omkring det antal, der er til salg."
            value={values.batchSize}
            min={WAITLIST_SETTING_LIMITS.batchSize.min}
            max={WAITLIST_SETTING_LIMITS.batchSize.max}
            error={errors.batchSize}
            onChange={set("batchSize")}
          />
          <s-number-field
            label="Interval (minutter)"
            details="Tid mellem to portioner. Før hver portion tjekkes det, at varen stadig kan købes."
            value={values.batchMinutes}
            min={WAITLIST_SETTING_LIMITS.batchMinutes.min}
            max={WAITLIST_SETTING_LIMITS.batchMinutes.max}
            error={errors.batchMinutes}
            onChange={set("batchMinutes")}
          />
          <s-stack direction="inline">
            <s-button
              variant="primary"
              onClick={() => fetcher.submit(values, { method: "POST" })}
              {...(busy ? { loading: true } : {})}
            >
              Gem
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Kun besked om varen">
        <s-paragraph>
          Kunden har selv bedt om beskeden, så den må sendes uden samtykke — men
          kun hvis den handler om varen. Læg du tilbud, andre varer eller
          rabatkoder i den, bliver den markedsføring og kræver samtykke
          (markedsføringslovens § 10). Tilmeldingen må ikke bruges til
          nyhedsbrev.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
