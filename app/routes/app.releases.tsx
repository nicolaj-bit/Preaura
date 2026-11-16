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
import { releaseFor } from "../models/release.server";
import { fetchShopTimeZone, numericId } from "../lib/shopifyProducts.server";
import { parseReleaseSettings, LIMITS } from "../release/settings";
import { scheduleQueue } from "../orders/scheduler.server";
import {
  formatDate,
  formatDateTime,
  translate,
  useT,
  type MessageKey,
} from "../i18n";
import { localeFor } from "../i18n/locale.server";

// Annulleringer og afviste betalinger: kundernes anmodninger, ordrer hvor
// opkrævningen ved afsendelse er afvist, og butikkens regler for begge.
// Appen udbetaler aldrig penge — refundering sker i Shopify.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await requireSubscription(request);
  const release = releaseFor(session.shop);
  const [requests, issues, settings, timeZone] = await Promise.all([
    release.cancellations.list(),
    release.payments.list(),
    release.settings(),
    fetchShopTimeZone(admin.graphql),
  ]);
  const locale = await localeFor(request, session.shop);
  const format = {
    format: (date: Date) => formatDateTime(locale, date, timeZone),
  };
  const orderName = (name: string | null, orderId: string) =>
    name || translate(locale, "product.order", { number: numericId(orderId) });
  return {
    settings,
    requests: requests.map((r) => ({
      id: r.id,
      orderName: orderName(r.orderName, r.orderId),
      orderNumber: numericId(r.orderId),
      source: r.source,
      status: r.status,
      at: format.format(r.requestedAt),
      units: r.lines.reduce(
        (n, l) => n + (l.from != null ? l.from - l.quantity : 0),
        0,
      ),
      error: r.lastError,
    })),
    issues: issues.map((i) => ({
      id: i.id,
      orderName: orderName(i.orderName, i.orderId),
      orderNumber: numericId(i.orderId),
      status: i.status,
      failedAt: format.format(i.failedAt),
      releaseAt: format.format(i.releaseAt),
      deliveries: i.deliveries.map((d) =>
        translate(locale, "releases.deliveryLine", {
          count: d.quantity,
          position: d.position,
          date: formatDate(locale, d.date),
        }),
      ),
      error: i.lastError,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await requireSubscription(request);
  const form = Object.fromEntries(await request.formData());
  const release = releaseFor(session.shop);
  const locale = await localeFor(request, session.shop);
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(locale, key, vars);
  const id = String(form.id ?? "");
  switch (form.intent) {
    case "approve":
      await release.cancellations.approve(id);
      scheduleQueue(session.shop, 0);
      return { ok: true as const, message: t("releases.toast.approved") };
    case "reject":
      await release.cancellations.reject(id);
      return { ok: true as const, message: t("releases.toast.rejected") };
    case "retry":
      await release.cancellations.retry(id);
      scheduleQueue(session.shop, 0);
      return { ok: true as const, message: t("releases.toast.retry") };
    case "release":
      await release.payments.releaseNow(id);
      scheduleQueue(session.shop, 0);
      return { ok: true as const, message: t("releases.toast.releasing") };
    case "extend": {
      const settings = await release.settings();
      await release.payments.extend(id, settings.paymentGraceDays);
      return {
        ok: true as const,
        message: t("releases.toast.extended", {
          count: settings.paymentGraceDays,
        }),
      };
    }
    case "settings": {
      const parsed = parseReleaseSettings(form, locale);
      if (!parsed.ok) return { ok: false as const, errors: parsed.errors };
      await release.updateSettings(parsed.values);
      return { ok: true as const, message: t("releases.toast.saved") };
    }
  }
  return { ok: false as const, errors: {} };
};

type Tone = "info" | "success" | "warning" | "critical";
const REQUEST_TONES: Record<string, Tone> = {
  PENDING: "warning",
  APPROVED: "info",
  DONE: "success",
  REJECTED: "info",
  FAILED: "critical",
};
const ISSUE_TONES: Record<string, Tone> = {
  OPEN: "warning",
  RELEASING: "info",
  RELEASED: "info",
  PAID: "success",
  CLOSED: "info",
};

export default function Releases() {
  const { settings, requests, issues } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const { t } = useT();
  const requestStatus = (status: string) =>
    status in REQUEST_TONES
      ? t(`releases.request.${status}` as MessageKey)
      : status;
  const issueStatus = (status: string) =>
    status in ISSUE_TONES
      ? t(`releases.issue.${status}` as MessageKey)
      : status;
  const [values, setValues] = useState({
    cancelWindow: settings.cancelWindow as string,
    cancelDays: String(settings.cancelDays),
    cancelApproval: settings.cancelApproval as string,
    cancelAutoDays: String(settings.cancelAutoDays),
    paymentGraceDays: String(settings.paymentGraceDays),
  });
  const errors: Record<string, string | undefined> =
    fetcher.data && !fetcher.data.ok ? fetcher.data.errors : {};

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show(fetcher.data.message);
  }, [fetcher.data, shopify]);

  const send = (intent: string, id?: string) =>
    fetcher.submit({ intent, ...(id ? { id } : {}) }, { method: "POST" });
  const set = (field: keyof typeof values) => (event: Event) => {
    const value = (event.currentTarget as HTMLInputElement).value;
    setValues((current) => ({ ...current, [field]: value }));
  };
  const choose = (field: keyof typeof values) => (event: Event) => {
    const value = (event.currentTarget as unknown as { values: string[] })
      .values[0];
    setValues((current) => ({ ...current, [field]: value }));
  };

  const pending = requests.filter((r) => r.status === "PENDING");
  const openIssues = issues.filter(
    (i) => i.status === "OPEN" || i.status === "RELEASING",
  );
  const history = requests.filter((r) => r.status !== "PENDING");
  const closedIssues = issues.filter(
    (i) => i.status !== "OPEN" && i.status !== "RELEASING",
  );

  return (
    <s-page heading={t("releases.heading")}>
      <s-banner tone="info">
        <s-paragraph>{t("releases.noPayout")}</s-paragraph>
      </s-banner>

      <s-section
        heading={t("releases.requests.heading", { count: pending.length })}
      >
        {pending.length === 0 ? (
          <s-paragraph>{t("releases.requests.none")}</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">
                {t("releases.col.order")}
              </s-table-header>
              <s-table-header>{t("releases.col.received")}</s-table-header>
              <s-table-header format="numeric">
                {t("releases.col.units")}
              </s-table-header>
              <s-table-header>{t("releases.col.action")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {pending.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>
                    <s-link href={`shopify://admin/orders/${r.orderNumber}`}>
                      {r.orderName}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{r.at}</s-table-cell>
                  <s-table-cell>{r.units}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-200">
                      <s-button
                        variant="primary"
                        onClick={() => send("approve", r.id)}
                      >
                        {t("releases.approve")}
                      </s-button>
                      <s-button onClick={() => send("reject", r.id)}>
                        {t("releases.reject")}
                      </s-button>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section
        heading={t("releases.issues.heading", { count: openIssues.length })}
      >
        <s-paragraph>{t("releases.issues.intro")}</s-paragraph>
        {openIssues.length === 0 ? (
          <s-paragraph>{t("releases.issues.none")}</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">
                {t("releases.col.order")}
              </s-table-header>
              <s-table-header>{t("releases.col.declined")}</s-table-header>
              <s-table-header>{t("releases.col.releases")}</s-table-header>
              <s-table-header>{t("releases.col.delivery")}</s-table-header>
              <s-table-header>{t("releases.col.action")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {openIssues.map((i) => (
                <s-table-row key={i.id}>
                  <s-table-cell>
                    <s-link href={`shopify://admin/orders/${i.orderNumber}`}>
                      {i.orderName}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{i.failedAt}</s-table-cell>
                  <s-table-cell>
                    {i.status === "RELEASING" ? t("releases.now") : i.releaseAt}
                    {i.error ? (
                      <s-text tone="critical"> {i.error}</s-text>
                    ) : null}
                  </s-table-cell>
                  <s-table-cell>{i.deliveries.join("; ") || "–"}</s-table-cell>
                  <s-table-cell>
                    {i.status === "OPEN" && (
                      <s-stack direction="inline" gap="small-200">
                        <s-button onClick={() => send("release", i.id)}>
                          {t("releases.releaseNow")}
                        </s-button>
                        <s-button onClick={() => send("extend", i.id)}>
                          {t("releases.extend")}
                        </s-button>
                      </s-stack>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading={t("releases.rules.heading")}>
        <s-stack gap="base">
          <s-choice-list
            label={t("releases.rules.window")}
            name="cancelWindow"
            values={[values.cancelWindow]}
            error={errors.cancelWindow}
            onChange={choose("cancelWindow")}
          >
            <s-choice value="UNTIL_FULFILLED">
              {t("releases.rules.untilShipped")}
            </s-choice>
            <s-choice value="DAYS">{t("releases.rules.days")}</s-choice>
          </s-choice-list>
          {values.cancelWindow === "DAYS" && (
            <s-number-field
              label={t("releases.rules.daysLabel")}
              details={t("releases.rules.daysDetails")}
              value={values.cancelDays}
              min={LIMITS.cancelDays.min}
              max={LIMITS.cancelDays.max}
              error={errors.cancelDays}
              onChange={set("cancelDays")}
            />
          )}
          <s-choice-list
            label={t("releases.rules.approval")}
            name="cancelApproval"
            values={[values.cancelApproval]}
            error={errors.cancelApproval}
            onChange={choose("cancelApproval")}
          >
            <s-choice value="MANUAL">{t("releases.rules.manual")}</s-choice>
            <s-choice value="AUTO">{t("releases.rules.auto")}</s-choice>
          </s-choice-list>
          {values.cancelApproval === "AUTO" && (
            <s-number-field
              label={t("releases.rules.autoLabel")}
              details={t("releases.rules.autoDetails")}
              value={values.cancelAutoDays}
              min={LIMITS.cancelAutoDays.min}
              max={LIMITS.cancelAutoDays.max}
              error={errors.cancelAutoDays}
              onChange={set("cancelAutoDays")}
            />
          )}
          <s-number-field
            label={t("releases.rules.grace")}
            details={t("releases.rules.graceDetails")}
            value={values.paymentGraceDays}
            min={LIMITS.paymentGraceDays.min}
            max={LIMITS.paymentGraceDays.max}
            error={errors.paymentGraceDays}
            onChange={set("paymentGraceDays")}
          />
          <s-stack direction="inline">
            <s-button
              variant="primary"
              onClick={() =>
                fetcher.submit(
                  { intent: "settings", ...values },
                  { method: "POST" },
                )
              }
            >
              {t("product.save")}
            </s-button>
          </s-stack>
          <s-paragraph>
            {t("releases.rules.link", { field: "preaura.cancel_url" })}
          </s-paragraph>
        </s-stack>
      </s-section>

      {(history.length > 0 || closedIssues.length > 0) && (
        <s-section heading={t("releases.history")}>
          <s-unordered-list>
            {history.map((r) => (
              <s-list-item key={r.id}>
                {t("releases.history.request", {
                  order: r.orderName,
                  count: r.units,
                  date: r.at,
                })}{" "}
                <s-badge tone={REQUEST_TONES[r.status] ?? "info"}>
                  {requestStatus(r.status)}
                </s-badge>
                {r.error && r.status !== "DONE" && (
                  <>
                    {" "}
                    <s-text tone="critical">
                      {r.status === "APPROVED"
                        ? t("releases.history.retrying")
                        : ""}
                      {r.error}
                    </s-text>
                  </>
                )}
                {r.status === "FAILED" && (
                  <>
                    {" "}
                    <s-button onClick={() => send("retry", r.id)}>
                      {t("queue.retry")}
                    </s-button>
                  </>
                )}
              </s-list-item>
            ))}
            {closedIssues.map((i) => (
              <s-list-item key={i.id}>
                {t("releases.history.issue", {
                  order: i.orderName,
                  date: i.failedAt,
                })}{" "}
                <s-badge tone={ISSUE_TONES[i.status] ?? "info"}>
                  {issueStatus(i.status)}
                </s-badge>
              </s-list-item>
            ))}
          </s-unordered-list>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
