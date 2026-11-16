import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { forShop } from "../models/preorder.server";
import { queueFor } from "../models/queue.server";
import { complianceFor } from "../models/compliance.server";
import { enqueueWebhook } from "../lib/webhookQueue.server";
import { scheduleQueue } from "../orders/scheduler.server";
import { orderRef } from "../orders/processQueue.server";
import { fetchShopTimeZone } from "../lib/shopifyProducts.server";
import { numericId } from "../lib/ids";
import { isEventType } from "../events/build";
import { CHANNEL_LABELS, type Channel } from "../events/labels";
import {
  formatDate,
  formatDateTime,
  localizeStored,
  translate,
  translateCount,
  useT,
  type Locale,
  type MessageKey,
} from "../i18n";
import { localeFor } from "../i18n/locale.server";

// Ordrebehandling: hændelser, der ikke kunne behandles, og ordrelinjer uden
// plads i nogen leverance. Intet må forsvinde i en log. Og kunders
// anmodninger om at se deres data (GDPR).

const STATUSES = ["ACTIVE", "UNRESOLVED", "CANCELLED"];
const TOPICS = [
  "CUSTOMERS_DATA_REQUEST",
  "CUSTOMERS_REDACT",
  "SHOP_REDACT",
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "ORDERS_CANCELLED",
  "REFUNDS_CREATE",
  "ORDER_TRANSACTIONS_CREATE",
];

const statusLabel = (locale: Locale, status: string) =>
  STATUSES.includes(status)
    ? translate(locale, `queue.status.${status}` as MessageKey)
    : status;
const topicLabel = (locale: Locale, topic: string) =>
  TOPICS.includes(topic)
    ? translate(locale, `queue.topic.${topic}` as MessageKey)
    : topic;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const queue = queueFor(session.shop);
  const data = forShop(session.shop);
  const locale = await localeFor(request, session.shop);
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(locale, key, vars);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [
    counts,
    failed,
    unresolved,
    withoutPlan,
    withoutPlan30,
    timeZone,
    dataRequests,
  ] = await Promise.all([
    queue.countByStatus(),
    queue.failed(),
    data.orders.unresolved(),
    data.orders.withoutPlan(50),
    data.orders.countWithoutPlanSince(thirtyDaysAgo),
    fetchShopTimeZone(admin.graphql),
    complianceFor(session.shop).dataRequests(),
  ]);
  const format = {
    format: (date: Date) => formatDateTime(locale, date, timeZone),
  };

  return {
    pending: counts.PENDING ?? 0,
    dataRequests: dataRequests.map((request) => ({
      id: request.id,
      customerId: request.customerId,
      receivedAt: format.format(request.receivedAt),
      answeredAt: request.answeredAt ? format.format(request.answeredAt) : null,
      orderCount: request.orderIds.length,
      // Kundens tilmeldinger til ventelisten (uden e-mailen selv).
      waitlist: request.waitlist.map((entry) =>
        t("queue.waitlistLine", {
          variant: numericId(entry.variantId),
          product: numericId(entry.productId),
          signedUp: format.format(new Date(entry.signedUpAt)),
          notified: entry.notifiedAt
            ? t("queue.waitlistNotified", {
                date: format.format(new Date(entry.notifiedAt)),
              })
            : t("queue.waitlistWaiting"),
        }),
      ),
      orders: request.data.map((order) => ({
        name:
          order.orderName ||
          t("product.order", { number: numericId(order.orderId) }),
        lines: order.lines.map((line) =>
          [
            t("queue.lineUnits", { count: line.quantity }),
            statusLabel(locale, line.status),
            line.promisedDate
              ? t("queue.linePromised", {
                  date: formatDate(locale, line.promisedDate),
                })
              : null,
          ]
            .filter(Boolean)
            .join(", "),
        ),
        events: (order.sentEvents ?? []).map(
          (event) =>
            t("queue.eventSent", {
              event: isEventType(event.type)
                ? t(`event.${event.type}` as MessageKey)
                : event.type,
              recipients:
                event.recipients
                  .map((r) => CHANNEL_LABELS[r as Channel] ?? r)
                  .join(", ") || t("queue.noRecipients"),
            }) + (event.containsContact ? t("queue.contactEncrypted") : ""),
        ),
      })),
    })),
    failed: failed.map((event) => {
      const ref = orderRef(event);
      return {
        id: event.id,
        topic: topicLabel(locale, event.topic),
        orderNumber: ref ? numericId(ref.orderId) : null,
        error: event.lastError
          ? localizeStored(locale, event.lastError)
          : t("queue.unknownError"),
        attempts: event.attempts,
        receivedAt: format.format(event.receivedAt),
      };
    }),
    withoutPlan30,
    withoutPlan: withoutPlan.map((row) => ({
      id: row.id,
      orderNumber: numericId(row.orderId),
      orderName: row.orderName,
      quantity: row.quantity,
      status: statusLabel(locale, row.status),
      orderedAt: row.orderCreatedAt ? format.format(row.orderCreatedAt) : "–",
    })),
    unresolved: unresolved.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      orderNumber: numericId(row.orderId),
      orderName: row.orderName,
      quantity: row.quantity,
      orderedAt: row.orderCreatedAt ? format.format(row.orderCreatedAt) : "–",
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const queue = queueFor(session.shop);
  const locale = await localeFor(request, session.shop);
  const t = (key: MessageKey) => translate(locale, key);

  switch (form.get("intent")) {
    case "retry": {
      const id = form.get("eventId");
      const count = await queue.retry(id ? String(id) : undefined);
      scheduleQueue(session.shop, 0);
      return {
        ok: true,
        message: translateCount(locale, "queue.retried", count),
      };
    }
    case "answer": {
      const count = await complianceFor(session.shop).markAnswered(
        String(form.get("requestId")),
      );
      return count === 1
        ? { ok: true, message: t("queue.answered") }
        : { ok: false, message: t("queue.requestMissing") };
    }
    case "reprocess": {
      // Behandl en ordre igen, fx når der er kommet en ny leverance med plads.
      const orderId = String(form.get("orderId"));
      if (!orderId.startsWith("gid://shopify/Order/")) {
        return { ok: false, message: t("queue.unknownOrder") };
      }
      await enqueueWebhook({
        webhookId: `manual-${orderId}-${Date.now()}`,
        shop: session.shop,
        topic: "ORDERS_UPDATED",
        payload: { admin_graphql_api_id: orderId },
      });
      scheduleQueue(session.shop, 0);
      return { ok: true, message: t("queue.reprocessing") };
    }
    default:
      return { ok: false, message: t("common.unknownAction") };
  }
};

export default function QueuePage() {
  const {
    pending,
    failed,
    unresolved,
    withoutPlan,
    withoutPlan30,
    dataRequests,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const { t, tn } = useT();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    }
  }, [fetcher.data, shopify]);

  const submit = (values: Record<string, string>) =>
    fetcher.submit(values, { method: "POST" });

  return (
    <s-page heading={t("queue.heading")}>
      {failed.length > 0 && (
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={() => submit({ intent: "retry" })}
          {...(busy ? { loading: true } : {})}
        >
          {t("queue.retryAll")}
        </s-button>
      )}

      {pending > 0 && (
        <s-banner tone="info">{tn("queue.pending", pending)}</s-banner>
      )}

      {dataRequests.length > 0 && (
        <s-section heading={t("queue.data.heading")}>
          <s-stack gap="base">
            <s-paragraph>{t("queue.data.intro")}</s-paragraph>
            {dataRequests.map((request) => (
              <s-box
                key={request.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack gap="small-200">
                  <s-stack direction="inline" gap="small-200">
                    <s-link
                      href={`shopify://admin/customers/${request.customerId}`}
                    >
                      {t("queue.data.customer", { id: request.customerId })}
                    </s-link>
                    {request.answeredAt ? (
                      <s-badge tone="success">
                        {t("queue.data.answered", { date: request.answeredAt })}
                      </s-badge>
                    ) : (
                      <s-badge tone="warning">
                        {t("queue.data.waiting")}
                      </s-badge>
                    )}
                  </s-stack>
                  <s-text color="subdued">
                    {t("queue.data.received", { date: request.receivedAt })}
                  </s-text>
                  {request.orders.length === 0 ? (
                    <s-paragraph>
                      {tn("queue.data.nothing", request.orderCount)}
                    </s-paragraph>
                  ) : (
                    <s-unordered-list>
                      {request.orders.map((order) => (
                        <s-list-item key={order.name}>
                          {order.name}: {order.lines.join("; ")}
                          {order.events.length > 0
                            ? t("queue.data.events", {
                                events: order.events.join("; "),
                              })
                            : ""}
                        </s-list-item>
                      ))}
                    </s-unordered-list>
                  )}
                  {request.waitlist.length > 0 && (
                    <s-unordered-list>
                      {request.waitlist.map((line) => (
                        <s-list-item key={line}>{line}</s-list-item>
                      ))}
                    </s-unordered-list>
                  )}
                  {!request.answeredAt && (
                    <s-button
                      onClick={() =>
                        submit({ intent: "answer", requestId: request.id })
                      }
                    >
                      {t("queue.data.markAnswered")}
                    </s-button>
                  )}
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      )}

      <s-section heading={t("queue.unresolved.heading")}>
        {unresolved.length === 0 ? (
          <s-paragraph>{t("queue.unresolved.none")}</s-paragraph>
        ) : (
          <s-stack gap="base">
            <s-paragraph>{t("queue.unresolved.intro")}</s-paragraph>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">
                  {t("queue.col.order")}
                </s-table-header>
                <s-table-header format="numeric">
                  {t("queue.col.unplaced")}
                </s-table-header>
                <s-table-header>{t("queue.col.ordered")}</s-table-header>
                <s-table-header>{t("queue.col.action")}</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {unresolved.map((row) => (
                  <s-table-row key={row.id}>
                    <s-table-cell>
                      <s-link
                        href={`shopify://admin/orders/${row.orderNumber}`}
                      >
                        {row.orderName ||
                          t("product.order", { number: row.orderNumber })}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>{row.quantity}</s-table-cell>
                    <s-table-cell>{row.orderedAt}</s-table-cell>
                    <s-table-cell>
                      <s-button
                        onClick={() =>
                          submit({ intent: "reprocess", orderId: row.orderId })
                        }
                      >
                        {t("queue.reprocess")}
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-stack>
        )}
      </s-section>

      <s-section heading={t("queue.withoutPlan.heading")}>
        {withoutPlan.length === 0 ? (
          <s-paragraph>{t("queue.withoutPlan.none")}</s-paragraph>
        ) : (
          <s-stack gap="base">
            <s-paragraph>
              {tn("queue.withoutPlan.intro", withoutPlan30)}
            </s-paragraph>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">
                  {t("queue.col.order")}
                </s-table-header>
                <s-table-header format="numeric">
                  {t("queue.col.quantity")}
                </s-table-header>
                <s-table-header listSlot="secondary">
                  {t("queue.col.status")}
                </s-table-header>
                <s-table-header>{t("queue.col.ordered")}</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {withoutPlan.map((row) => (
                  <s-table-row key={row.id}>
                    <s-table-cell>
                      <s-link
                        href={`shopify://admin/orders/${row.orderNumber}`}
                      >
                        {row.orderName ||
                          t("product.order", { number: row.orderNumber })}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>{row.quantity}</s-table-cell>
                    <s-table-cell>{row.status}</s-table-cell>
                    <s-table-cell>{row.orderedAt}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-stack>
        )}
      </s-section>

      <s-section heading={t("queue.failed.heading")}>
        {failed.length === 0 ? (
          <s-paragraph>{t("queue.failed.none")}</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">
                {t("queue.col.event")}
              </s-table-header>
              <s-table-header>{t("queue.col.order")}</s-table-header>
              <s-table-header listSlot="secondary">
                {t("queue.col.error")}
              </s-table-header>
              <s-table-header>{t("queue.col.received")}</s-table-header>
              <s-table-header>{t("queue.col.action")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {failed.map((event) => (
                <s-table-row key={event.id}>
                  <s-table-cell>{event.topic}</s-table-cell>
                  <s-table-cell>
                    {event.orderNumber ? (
                      <s-link
                        href={`shopify://admin/orders/${event.orderNumber}`}
                      >
                        {event.orderNumber}
                      </s-link>
                    ) : (
                      "–"
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <s-text tone="critical">{event.error}</s-text>
                  </s-table-cell>
                  <s-table-cell>{event.receivedAt}</s-table-cell>
                  <s-table-cell>
                    <s-button
                      onClick={() =>
                        submit({ intent: "retry", eventId: event.id })
                      }
                    >
                      {t("queue.retry")}
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
