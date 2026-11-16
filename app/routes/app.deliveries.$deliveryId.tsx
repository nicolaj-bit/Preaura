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
import { allocatedQuantity, remainingQuantity } from "../lib/deliveries";
import { fetchShopTimeZone } from "../lib/shopifyProducts.server";
import { numericId } from "../lib/ids";
import { shopifySync } from "../sync/index.server";
import { scheduleQueue } from "../orders/scheduler.server";
import {
  formatDateTime,
  translate,
  translateCount,
  useT,
  type MessageKey,
} from "../i18n";
import { localeFor } from "../i18n/locale.server";

// En leverance med dens ordrer. Siden, webshopejeren bruger, når sendingen
// kommer hjem: hvem skal have hvad.

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await localeFor(request, session.shop);
  const result = await forShop(session.shop).orders.forDelivery(
    String(params.deliveryId),
  );
  if (!result) {
    throw new Response(translate(locale, "delivery.notFound"), {
      status: 404,
    });
  }
  const { delivery, allocations } = result;
  const timeZone = await fetchShopTimeZone(admin.graphql);

  return {
    delivery: {
      position: delivery.position,
      date: delivery.date,
      quantity: delivery.quantity,
      status: delivery.status,
      allocated: allocatedQuantity(allocations),
      remaining: remainingQuantity(delivery.quantity, allocations),
    },
    orders: allocations.map((row) => ({
      id: row.id,
      orderNumber: numericId(row.orderId),
      orderName: row.orderName,
      quantity: row.quantity,
      status: row.status,
      orderedAt: row.orderCreatedAt
        ? formatDateTime(locale, row.orderCreatedAt, timeZone)
        : "–",
      promisedDate: row.promisedDate,
      ready: row.readyAt != null,
    })),
  };
};

/**
 * «Varerne er kommet»: alle aktive forudbestillinger i leverancen markeres
 * klar til afsendelse og giver en hændelse hver. Bruges, når varerne ikke
 * registreres som lager i Shopify (det gør appen ellers selv).
 */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await localeFor(request, session.shop);
  const form = await request.formData();
  if (form.get("intent") !== "ready") {
    return { ok: false, message: translate(locale, "common.unknownAction") };
  }
  const { variantId, count } = await forShop(session.shop).deliveries.markReady(
    String(params.deliveryId),
  );
  await shopifySync(admin.graphql, session.shop).sync(variantId);
  scheduleQueue(session.shop, 0);
  return {
    ok: true,
    message:
      count === 0
        ? translate(locale, "delivery.readyNone")
        : translateCount(locale, "delivery.ready", count),
  };
};

const STATUS_TONES: Record<string, "success" | "critical" | "neutral"> = {
  ACTIVE: "success",
  CANCELLED: "neutral",
};

export default function DeliveryOrders() {
  const { delivery, orders } = useLoaderData<typeof loader>();
  const active = orders.filter((o) => o.status === "ACTIVE");
  const waiting = active.filter((o) => !o.ready).length;
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const { t, date } = useT();

  useEffect(() => {
    if (fetcher.data) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    }
  }, [fetcher.data, shopify]);

  return (
    <s-page
      heading={t("delivery.heading", {
        position: delivery.position,
        date: date(delivery.date),
      })}
    >
      <s-link slot="breadcrumb-actions" href="/app">
        {t("nav.products")}
      </s-link>
      {waiting > 0 && (
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={() =>
            fetcher.submit({ intent: "ready" }, { method: "POST" })
          }
          {...(fetcher.state !== "idle" ? { loading: true } : {})}
        >
          {t("delivery.arrived")}
        </s-button>
      )}

      <s-section>
        <s-grid gridTemplateColumns="1fr 1fr 1fr 1fr" gap="base">
          <s-stack gap="small-500">
            <s-text color="subdued">{t("product.col.quantity")}</s-text>
            <s-text>{delivery.quantity}</s-text>
          </s-stack>
          <s-stack gap="small-500">
            <s-text color="subdued">{t("product.col.allocated")}</s-text>
            <s-text>{delivery.allocated}</s-text>
          </s-stack>
          <s-stack gap="small-500">
            <s-text color="subdued">{t("product.col.remaining")}</s-text>
            <s-text>{delivery.remaining}</s-text>
          </s-stack>
          <s-stack gap="small-500">
            <s-text color="subdued">{t("delivery.activeLines")}</s-text>
            <s-text>{active.length}</s-text>
          </s-stack>
        </s-grid>
      </s-section>

      <s-section heading={t("delivery.orders")} padding="none">
        {orders.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>{t("delivery.noOrders")}</s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">
                {t("delivery.col.order")}
              </s-table-header>
              <s-table-header format="numeric">
                {t("product.col.quantity")}
              </s-table-header>
              <s-table-header listSlot="secondary">
                {t("product.col.status")}
              </s-table-header>
              <s-table-header>{t("delivery.col.ordered")}</s-table-header>
              <s-table-header>{t("delivery.col.promised")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {orders.map((order) => {
                const tone = STATUS_TONES[order.status] ?? "neutral";
                const label =
                  order.status === "ACTIVE" || order.status === "CANCELLED"
                    ? t(`delivery.status.${order.status}` as MessageKey)
                    : order.status;
                return (
                  <s-table-row key={order.id}>
                    <s-table-cell>
                      <s-link
                        href={`shopify://admin/orders/${order.orderNumber}`}
                      >
                        {order.orderName ||
                          t("product.order", { number: order.orderNumber })}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>{order.quantity}</s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200">
                        <s-badge tone={tone}>{label}</s-badge>
                        {order.status === "ACTIVE" && order.ready ? (
                          <s-badge tone="info">
                            {t("delivery.readyBadge")}
                          </s-badge>
                        ) : null}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>{order.orderedAt}</s-table-cell>
                    <s-table-cell>
                      {order.promisedDate ? date(order.promisedDate) : "–"}
                    </s-table-cell>
                  </s-table-row>
                );
              })}
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
