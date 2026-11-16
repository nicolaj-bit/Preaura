import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { outboxFor } from "../models/outbox.server";
import { scheduleQueue } from "../orders/scheduler.server";
import { fetchShopTimeZone } from "../lib/shopifyProducts.server";
import {
  validateKlaviyoKey,
  validateWebhookUrl,
} from "../lib/integrationInput";
import { numericId } from "../lib/ids";
import { isEventType } from "../events/build";
import {
  CHANNEL_LABELS,
  SIGNATURE_HEADER,
  type Channel,
} from "../events/labels";
import {
  formatDateTime,
  localizeStored,
  translate,
  translateCount,
  useT,
  type Locale,
  type MessageKey,
} from "../i18n";
import { localeFor } from "../i18n/locale.server";

// Hændelser: modtagere (Flow, webhook, Klaviyo), fejlede leveringer og
// logbogen. Nøgler og adresser vises aldrig — kun de sidste fire tegn.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const outbox = outboxFor(session.shop);
  const [settings, failed, log, waiting, timeZone] = await Promise.all([
    outbox.integrations.view(),
    outbox.deliveries.failed(),
    outbox.deliveries.log(50),
    outbox.events.unbuilt(50),
    fetchShopTimeZone(admin.graphql),
  ]);
  const locale = await localeFor(request, session.shop);
  const format = {
    format: (date: Date) => formatDateTime(locale, date, timeZone),
  };
  const label = (type: string) =>
    isEventType(type) ? translate(locale, `event.${type}` as MessageKey) : type;
  const row = (d: (typeof log)[number]) => ({
    id: d.id,
    type: label(d.event.type),
    channel: CHANNEL_LABELS[d.channel as Channel] ?? d.channel,
    ...reference(d.event, locale),
    at: format.format(d.deliveredAt ?? d.updatedAt),
    status: d.status,
    attempts: d.attempts,
    error: d.lastError ? localizeStored(locale, d.lastError) : null,
  });
  return {
    settings: {
      ...settings,
      responsibilityAcceptedAt: settings.responsibilityAcceptedAt
        ? format.format(settings.responsibilityAcceptedAt)
        : null,
    },
    failed: failed.map((d) => ({
      ...row(d),
      canRetry: d.event.payloadEnc != null,
    })),
    log: log.map(row),
    // Hændelser, der endnu ikke er bygget og sendt — med årsagen, hvis det
    // er gået galt. Uden dem ville en hændelse, der sidder fast, være usynlig.
    waiting: waiting.map((e) => ({
      id: e.id,
      type: label(e.type),
      ...reference(e, locale),
      at: format.format(e.createdAt),
      error: e.lastError ? localizeStored(locale, e.lastError) : null,
    })),
    encryptionMissing: !process.env.PREAURA_ENCRYPTION_KEY,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const locale = await localeFor(request, session.shop);
  const t = (key: MessageKey) => translate(locale, key);
  const integrations = outboxFor(session.shop).integrations;
  const deliveries = outboxFor(session.shop).deliveries;
  const on = form.get("enabled") === "true";

  switch (form.get("intent")) {
    case "responsibility":
      await integrations.acceptResponsibility(on);
      return {
        ok: true,
        message: on
          ? t("events.toast.confirmed")
          : t("events.toast.unconfirmed"),
      };
    case "flow":
      await integrations.setFlow(on);
      return {
        ok: true,
        message: on ? t("events.toast.flowOn") : t("events.toast.flowOff"),
      };
    case "webhookUrl": {
      const result = validateWebhookUrl(String(form.get("url") ?? ""));
      if (!result.ok) {
        return { ok: false, message: localizeStored(locale, result.error) };
      }
      await integrations.setWebhookUrl(result.url);
      return { ok: true, message: t("events.toast.urlSaved") };
    }
    case "webhookRemove":
      await integrations.setWebhookUrl(null);
      return { ok: true, message: t("events.toast.urlRemoved") };
    case "webhookEnabled":
      await integrations.setWebhookEnabled(on);
      return {
        ok: true,
        message: on
          ? t("events.toast.webhookOn")
          : t("events.toast.webhookOff"),
      };
    case "webhookSecret":
      await integrations.regenerateWebhookSecret();
      return { ok: true, message: t("events.toast.secret") };
    case "klaviyoKey": {
      const result = validateKlaviyoKey(String(form.get("key") ?? ""));
      if (!result.ok) {
        return { ok: false, message: localizeStored(locale, result.error) };
      }
      await integrations.setKlaviyoKey(result.key);
      return { ok: true, message: t("events.toast.keySaved") };
    }
    case "klaviyoRemove":
      await integrations.setKlaviyoKey(null);
      return { ok: true, message: t("events.toast.keyRemoved") };
    case "klaviyoEnabled":
      await integrations.setKlaviyoEnabled(on);
      return {
        ok: true,
        message: on
          ? t("events.toast.klaviyoOn")
          : t("events.toast.klaviyoOff"),
      };
    case "retry": {
      const id = form.get("deliveryId");
      const count = await deliveries.retry(id ? String(id) : undefined);
      scheduleQueue(session.shop, 0);
      return {
        ok: true,
        message: translateCount(locale, "events.toast.retried", count),
      };
    }
    default:
      return { ok: false, message: t("common.unknownAction") };
  }
};

const STATUS_TONES: Record<string, "success" | "critical" | "info"> = {
  DONE: "success",
  FAILED: "critical",
  PENDING: "info",
};

/** Ordren, hændelsen handler om — eller produktet for ventelisten. */
function reference(
  event: {
    orderId: string | null;
    orderName: string;
    productId?: string | null;
  },
  locale: Locale,
) {
  if (event.orderId) {
    return {
      reference: event.orderName || numericId(event.orderId),
      href: `shopify://admin/orders/${numericId(event.orderId)}`,
    };
  }
  return {
    reference: translate(locale, "events.waitlistRef"),
    href: event.productId
      ? `shopify://admin/products/${numericId(event.productId)}`
      : "/app/waitlist",
  };
}

export default function EventsPage() {
  const { settings, failed, log, waiting, encryptionMissing } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const { t } = useT();
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const accepted = settings.responsibilityAcceptedAt != null;

  // Felterne tømmes, når en nøgle eller adresse er gemt — så den ikke står
  // synlig på skærmen bagefter. Ved fejl bliver indtastningen stående.
  const [handled, setHandled] = useState(fetcher.data);
  if (fetcher.data !== handled) {
    setHandled(fetcher.data);
    if (fetcher.data?.ok) {
      setUrl("");
      setKey("");
    }
  }

  useEffect(() => {
    if (fetcher.data) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    }
  }, [fetcher.data, shopify]);

  const submit = (values: Record<string, string>) =>
    fetcher.submit(values, { method: "POST" });

  return (
    <s-page heading={t("events.heading")}>
      <s-section>
        <s-paragraph>{t("events.intro")}</s-paragraph>
      </s-section>

      <s-section heading={t("events.responsibility.heading")}>
        <s-stack gap="base">
          <s-banner tone="warning">
            <s-paragraph>{t("events.responsibility.warning")}</s-paragraph>
          </s-banner>
          <s-checkbox
            label={t("events.responsibility.label")}
            details={
              accepted
                ? t("events.responsibility.accepted", {
                    date: settings.responsibilityAcceptedAt ?? "",
                  })
                : t("events.responsibility.required")
            }
            checked={accepted}
            onChange={() =>
              submit({ intent: "responsibility", enabled: String(!accepted) })
            }
          />
        </s-stack>
      </s-section>

      <s-section heading="Shopify Flow">
        <s-stack gap="base">
          <s-switch
            label={t("events.flow.label")}
            details={t("events.flow.details")}
            checked={settings.flowEnabled}
            onChange={() =>
              submit({ intent: "flow", enabled: String(!settings.flowEnabled) })
            }
          />
        </s-stack>
      </s-section>

      <s-section heading="Webhook">
        <s-stack gap="base">
          <s-paragraph>{t("events.webhook.intro")}</s-paragraph>
          {settings.webhookUrlLast4 ? (
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-text>
                {t("events.webhook.saved", { last4: settings.webhookUrlLast4 })}
              </s-text>
              <s-button
                tone="critical"
                onClick={() => submit({ intent: "webhookRemove" })}
              >
                {t("events.remove")}
              </s-button>
            </s-stack>
          ) : null}
          <s-url-field
            label={
              settings.webhookUrlLast4
                ? t("events.webhook.newUrl")
                : t("events.webhook.url")
            }
            placeholder="https://hooks.zapier.com/…"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
          />
          <s-button
            disabled={!url}
            onClick={() => submit({ intent: "webhookUrl", url })}
          >
            {t("events.webhook.save")}
          </s-button>
          <s-switch
            label={t("events.webhook.label")}
            disabled={!accepted || !settings.webhookUrlLast4}
            checked={settings.webhookEnabled}
            onChange={() =>
              submit({
                intent: "webhookEnabled",
                enabled: String(!settings.webhookEnabled),
              })
            }
          />
          {settings.webhookSecret ? (
            <s-stack gap="small-200">
              <s-text type="strong">{t("events.webhook.secret")}</s-text>
              <s-text>
                <code>{settings.webhookSecret}</code>
              </s-text>
              <s-paragraph>
                {t("events.webhook.signature", { header: SIGNATURE_HEADER })}
              </s-paragraph>
              <s-button onClick={() => submit({ intent: "webhookSecret" })}>
                {t("events.webhook.newSecret")}
              </s-button>
            </s-stack>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Klaviyo">
        <s-stack gap="base">
          <s-paragraph>{t("events.klaviyo.intro")}</s-paragraph>
          {settings.klaviyoKeyLast4 ? (
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-text>
                {t("events.klaviyo.saved", { last4: settings.klaviyoKeyLast4 })}
              </s-text>
              <s-button
                tone="critical"
                onClick={() => submit({ intent: "klaviyoRemove" })}
              >
                {t("events.remove")}
              </s-button>
            </s-stack>
          ) : null}
          <s-password-field
            label={
              settings.klaviyoKeyLast4
                ? t("events.klaviyo.newKey")
                : t("events.klaviyo.key")
            }
            placeholder="pk_…"
            value={key}
            onChange={(e) => setKey(e.currentTarget.value)}
          />
          <s-button
            disabled={!key}
            onClick={() => submit({ intent: "klaviyoKey", key })}
          >
            {t("events.klaviyo.save")}
          </s-button>
          <s-switch
            label={t("events.klaviyo.label")}
            disabled={!accepted || !settings.klaviyoKeyLast4}
            checked={settings.klaviyoEnabled}
            onChange={() =>
              submit({
                intent: "klaviyoEnabled",
                enabled: String(!settings.klaviyoEnabled),
              })
            }
          />
        </s-stack>
      </s-section>

      {encryptionMissing && (
        <s-banner tone="critical" heading={t("events.encryption.heading")}>
          <s-paragraph>{t("events.encryption.text")}</s-paragraph>
        </s-banner>
      )}

      {waiting.length > 0 && (
        <s-section heading={t("events.waiting.heading")}>
          <s-stack gap="base">
            <s-paragraph>{t("events.waiting.intro")}</s-paragraph>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">
                  {t("events.col.event")}
                </s-table-header>
                <s-table-header>{t("events.col.reference")}</s-table-header>
                <s-table-header>{t("events.col.created")}</s-table-header>
                <s-table-header listSlot="secondary">
                  {t("events.col.error")}
                </s-table-header>
              </s-table-header-row>
              <s-table-body>
                {waiting.map((row) => (
                  <s-table-row key={row.id}>
                    <s-table-cell>{row.type}</s-table-cell>
                    <s-table-cell>
                      <s-link href={row.href}>{row.reference}</s-link>
                    </s-table-cell>
                    <s-table-cell>{row.at}</s-table-cell>
                    <s-table-cell>
                      {row.error ? (
                        <s-text tone="critical">{row.error}</s-text>
                      ) : (
                        "–"
                      )}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-stack>
        </s-section>
      )}

      <s-section heading={t("events.failed.heading")}>
        {failed.length === 0 ? (
          <s-paragraph>{t("events.failed.none")}</s-paragraph>
        ) : (
          <s-stack gap="base">
            <s-paragraph>{t("events.failed.intro")}</s-paragraph>
            <s-button
              variant="primary"
              onClick={() => submit({ intent: "retry" })}
            >
              {t("events.retryAll")}
            </s-button>
            <EventTable
              rows={failed}
              action={(row) =>
                row.canRetry ? (
                  <s-button
                    onClick={() =>
                      submit({ intent: "retry", deliveryId: row.id })
                    }
                  >
                    {t("events.retry")}
                  </s-button>
                ) : (
                  <s-text color="subdued">{t("events.dataDeleted")}</s-text>
                )
              }
            />
          </s-stack>
        )}
      </s-section>

      <s-section heading={t("events.log.heading")}>
        {log.length === 0 ? (
          <s-paragraph>{t("events.log.none")}</s-paragraph>
        ) : (
          <EventTable rows={log} />
        )}
      </s-section>

      <s-section heading={t("events.others.heading")}>
        <s-stack gap="base">
          <s-paragraph>{t("events.others.zapier")}</s-paragraph>
          <s-paragraph>{t("events.others.make")}</s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

type Row = {
  id: string;
  type: string;
  channel: string;
  reference: string;
  href: string;
  at: string;
  status: string;
  attempts: number;
  error: string | null;
};

function EventTable<T extends Row>({
  rows,
  action,
}: {
  rows: T[];
  action?: (row: T) => React.ReactNode;
}) {
  const { t } = useT();
  return (
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">
          {t("events.col.event")}
        </s-table-header>
        <s-table-header>{t("events.col.recipient")}</s-table-header>
        <s-table-header>{t("events.col.reference")}</s-table-header>
        <s-table-header>{t("events.col.time")}</s-table-header>
        <s-table-header listSlot="secondary">
          {t("events.col.status")}
        </s-table-header>
        <s-table-header>{t("events.col.message")}</s-table-header>
        {action ? (
          <s-table-header>{t("events.col.action")}</s-table-header>
        ) : null}
      </s-table-header-row>
      <s-table-body>
        {rows.map((row) => {
          const tone = STATUS_TONES[row.status] ?? "info";
          const text =
            row.status in STATUS_TONES
              ? t(`events.status.${row.status}` as MessageKey)
              : row.status;
          return (
            <s-table-row key={row.id}>
              <s-table-cell>{row.type}</s-table-cell>
              <s-table-cell>{row.channel}</s-table-cell>
              <s-table-cell>
                <s-link href={row.href}>{row.reference}</s-link>
              </s-table-cell>
              <s-table-cell>{row.at}</s-table-cell>
              <s-table-cell>
                <s-badge tone={tone}>
                  {text}
                  {row.attempts > 1
                    ? t("events.attempts", { count: row.attempts })
                    : ""}
                </s-badge>
              </s-table-cell>
              <s-table-cell>
                {row.error ? <s-text tone="critical">{row.error}</s-text> : "–"}
              </s-table-cell>
              {action ? <s-table-cell>{action(row)}</s-table-cell> : null}
            </s-table-row>
          );
        })}
      </s-table-body>
    </s-table>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
