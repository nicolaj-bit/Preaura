import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { forShop } from "../models/preorder.server";
import { allocatedQuantity, remainingQuantity } from "../lib/deliveries";
import { fetchShopTimeZone } from "../lib/shopifyProducts.server";
import { numericId } from "../lib/ids";

// En leverance med dens ordrer. Siden, webshopejeren bruger, når sendingen
// kommer hjem: hvem skal have hvad.

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const result = await forShop(session.shop).orders.forDelivery(
    String(params.deliveryId),
  );
  if (!result) throw new Response("Leverancen findes ikke.", { status: 404 });
  const { delivery, allocations } = result;
  const timeZone = await fetchShopTimeZone(admin.graphql);
  const format = new Intl.DateTimeFormat("da-DK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });

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
      orderedAt: row.orderCreatedAt ? format.format(row.orderCreatedAt) : "–",
      promisedDate: row.promisedDate,
    })),
  };
};

const dateFormat = new Intl.DateTimeFormat("da-DK", {
  dateStyle: "long",
  timeZone: "UTC",
});
const formatDate = (date: string) =>
  dateFormat.format(new Date(`${date}T00:00:00Z`));

const STATUS: Record<
  string,
  { label: string; tone: "success" | "critical" | "neutral" }
> = {
  ACTIVE: { label: "Aktiv", tone: "success" },
  CANCELLED: { label: "Annulleret", tone: "neutral" },
};

export default function DeliveryOrders() {
  const { delivery, orders } = useLoaderData<typeof loader>();
  const active = orders.filter((o) => o.status === "ACTIVE");

  return (
    <s-page
      heading={`Leverance ${delivery.position} · ${formatDate(delivery.date)}`}
    >
      <s-link slot="breadcrumb-actions" href="/app">
        Produkter
      </s-link>

      <s-section>
        <s-grid gridTemplateColumns="1fr 1fr 1fr 1fr" gap="base">
          <s-stack gap="small-500">
            <s-text color="subdued">Antal</s-text>
            <s-text>{delivery.quantity}</s-text>
          </s-stack>
          <s-stack gap="small-500">
            <s-text color="subdued">Tildelt</s-text>
            <s-text>{delivery.allocated}</s-text>
          </s-stack>
          <s-stack gap="small-500">
            <s-text color="subdued">Resterende</s-text>
            <s-text>{delivery.remaining}</s-text>
          </s-stack>
          <s-stack gap="small-500">
            <s-text color="subdued">Aktive ordrelinjer</s-text>
            <s-text>{active.length}</s-text>
          </s-stack>
        </s-grid>
      </s-section>

      <s-section heading="Ordrer" padding="none">
        {orders.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>Ingen ordrer i denne leverance endnu.</s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Ordre</s-table-header>
              <s-table-header format="numeric">Antal</s-table-header>
              <s-table-header listSlot="secondary">Status</s-table-header>
              <s-table-header>Bestilt</s-table-header>
              <s-table-header>Lovet dato</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {orders.map((order) => {
                const status = STATUS[order.status] ?? {
                  label: order.status,
                  tone: "neutral" as const,
                };
                return (
                  <s-table-row key={order.id}>
                    <s-table-cell>
                      <s-link
                        href={`shopify://admin/orders/${order.orderNumber}`}
                      >
                        {order.orderName || `Ordre ${order.orderNumber}`}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>{order.quantity}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={status.tone}>{status.label}</s-badge>
                    </s-table-cell>
                    <s-table-cell>{order.orderedAt}</s-table-cell>
                    <s-table-cell>
                      {order.promisedDate
                        ? formatDate(order.promisedDate)
                        : "–"}
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
