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
import { formatDate, translate, useT } from "../i18n";
import { localeFor } from "../i18n/locale.server";

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
  const locale = await localeFor(request, session.shop);
  const rows = waitlistRows(overview.waiting, overview.notified, names).map(
    (row) => ({
      ...row,
      productTitle:
        row.productTitle === "Ukendt produkt"
          ? translate(locale, "common.unknownProduct")
          : row.productTitle,
      productNumber: numericId(row.productId),
      notified: row.notified.map((n) => ({
        label: n.deliveryDate
          ? translate(locale, "waitlist.delivery", {
              date: formatDate(locale, n.deliveryDate),
            })
          : translate(locale, "waitlist.inStock"),
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
  const locale = await localeFor(request, session.shop);
  const parsed = parseWaitlistSettings(
    {
      stableMinutes: form.get("stableMinutes"),
      batchSize: form.get("batchSize"),
      batchMinutes: form.get("batchMinutes"),
    },
    locale,
  );
  if (!parsed.ok) return parsed;
  await waitlistFor(session.shop).updateSettings(parsed.values);
  return { ok: true as const };
};

export default function WaitlistPage() {
  const { rows, totalWaiting, settings, hasRecipients } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const { t } = useT();
  const [values, setValues] = useState({
    stableMinutes: String(settings.stableMinutes),
    batchSize: String(settings.batchSize),
    batchMinutes: String(settings.batchMinutes),
  });
  const errors = fetcher.data && !fetcher.data.ok ? fetcher.data.errors : {};
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show(t("waitlist.saved"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, shopify]);

  // Værdien læses med det samme: når React kører opdateringen, er
  // event.currentTarget allerede nulstillet.
  const set = (field: keyof typeof values) => (event: Event) => {
    const value = (event.currentTarget as HTMLInputElement).value;
    setValues((current) => ({ ...current, [field]: value }));
  };

  return (
    <s-page heading={t("waitlist.heading")}>
      {!hasRecipients && (
        <s-banner tone="warning" heading={t("waitlist.noRecipients.heading")}>
          <s-paragraph>
            {t("waitlist.noRecipients.text")}{" "}
            <s-link href="/app/events">{t("nav.events")}</s-link>.
          </s-paragraph>
        </s-banner>
      )}

      <s-section
        heading={t("waitlist.waiting.heading", { count: totalWaiting })}
      >
        {rows.length === 0 ? (
          <s-paragraph>{t("waitlist.empty")}</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">
                {t("waitlist.col.product")}
              </s-table-header>
              <s-table-header>{t("waitlist.col.variant")}</s-table-header>
              <s-table-header format="numeric">
                {t("waitlist.col.waiting")}
              </s-table-header>
              <s-table-header listSlot="secondary">
                {t("waitlist.col.notified")}
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

      <s-section heading={t("waitlist.how.heading")}>
        <s-stack gap="base">
          <s-paragraph>{t("waitlist.how.text")}</s-paragraph>
          <s-number-field
            label={t("waitlist.stable.label")}
            details={t("waitlist.stable.details")}
            value={values.stableMinutes}
            min={WAITLIST_SETTING_LIMITS.stableMinutes.min}
            max={WAITLIST_SETTING_LIMITS.stableMinutes.max}
            error={errors.stableMinutes}
            onChange={set("stableMinutes")}
          />
          <s-number-field
            label={t("waitlist.batch.label")}
            details={t("waitlist.batch.details")}
            value={values.batchSize}
            min={WAITLIST_SETTING_LIMITS.batchSize.min}
            max={WAITLIST_SETTING_LIMITS.batchSize.max}
            error={errors.batchSize}
            onChange={set("batchSize")}
          />
          <s-number-field
            label={t("waitlist.interval.label")}
            details={t("waitlist.interval.details")}
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
              {t("product.save")}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading={t("waitlist.only.heading")}>
        <s-paragraph>{t("waitlist.only.text")}</s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
