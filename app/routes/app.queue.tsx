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
import { enqueueWebhook } from "../lib/webhookQueue.server";
import { scheduleQueue } from "../orders/scheduler.server";
import { orderRef } from "../orders/processQueue.server";
import { fetchShopTimeZone } from "../lib/shopifyProducts.server";
import { numericId } from "../lib/ids";

// Ordrebehandling: hændelser, der ikke kunne behandles, og ordrelinjer uden
// plads i nogen leverance. Intet må forsvinde i en log.

const TOPIC_LABELS: Record<string, string> = {
  ORDERS_CREATE: "Ny ordre",
  ORDERS_UPDATED: "Ordre ændret",
  ORDERS_CANCELLED: "Ordre annulleret",
  REFUNDS_CREATE: "Refundering",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const queue = queueFor(session.shop);
  const data = forShop(session.shop);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [counts, failed, unresolved, withoutPlan, withoutPlan30, timeZone] =
    await Promise.all([
      queue.countByStatus(),
      queue.failed(),
      data.orders.unresolved(),
      data.orders.withoutPlan(50),
      data.orders.countWithoutPlanSince(thirtyDaysAgo),
      fetchShopTimeZone(admin.graphql),
    ]);
  const format = new Intl.DateTimeFormat("da-DK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });

  return {
    pending: counts.PENDING ?? 0,
    failed: failed.map((event) => {
      const ref = orderRef(event);
      return {
        id: event.id,
        topic: TOPIC_LABELS[event.topic] ?? event.topic,
        orderNumber: ref ? numericId(ref.orderId) : null,
        error: event.lastError ?? "Ukendt fejl.",
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
      status: row.status,
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

  switch (form.get("intent")) {
    case "retry": {
      const id = form.get("eventId");
      const count = await queue.retry(id ? String(id) : undefined);
      scheduleQueue(session.shop, 0);
      return { ok: true, message: `${count} hændelse(r) sat i kø igen` };
    }
    case "reprocess": {
      // Behandl en ordre igen, fx når der er kommet en ny leverance med plads.
      const orderId = String(form.get("orderId"));
      if (!orderId.startsWith("gid://shopify/Order/")) {
        return { ok: false, message: "Ukendt ordre." };
      }
      await enqueueWebhook({
        webhookId: `manual-${orderId}-${Date.now()}`,
        shop: session.shop,
        topic: "ORDERS_UPDATED",
        payload: { admin_graphql_api_id: orderId },
      });
      scheduleQueue(session.shop, 0);
      return { ok: true, message: "Ordren behandles igen" };
    }
    default:
      return { ok: false, message: "Ukendt handling." };
  }
};

export default function QueuePage() {
  const { pending, failed, unresolved, withoutPlan, withoutPlan30 } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    }
  }, [fetcher.data, shopify]);

  const submit = (values: Record<string, string>) =>
    fetcher.submit(values, { method: "POST" });

  return (
    <s-page heading="Ordrebehandling">
      {failed.length > 0 && (
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={() => submit({ intent: "retry" })}
          {...(busy ? { loading: true } : {})}
        >
          Prøv alle igen
        </s-button>
      )}

      {pending > 0 && (
        <s-banner tone="info">
          {pending} hændelse(r) venter på at blive behandlet. Det sker normalt
          inden for et minut.
        </s-banner>
      )}

      <s-section heading="Uafklarede ordrer">
        {unresolved.length === 0 ? (
          <s-paragraph>
            Alle forudbestillinger har plads i en leverance.
          </s-paragraph>
        ) : (
          <s-stack gap="base">
            <s-paragraph>
              Disse ordrelinjer er betalt, men der var ikke plads i nogen
              leverance. Opret en leverance med plads, og behandl ordren igen.
              Ordrerne har tagget «Forudbestilling uafklaret» i Shopify.
            </s-paragraph>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Ordre</s-table-header>
                <s-table-header format="numeric">
                  Antal uden plads
                </s-table-header>
                <s-table-header>Bestilt</s-table-header>
                <s-table-header>Handling</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {unresolved.map((row) => (
                  <s-table-row key={row.id}>
                    <s-table-cell>
                      <s-link
                        href={`shopify://admin/orders/${row.orderNumber}`}
                      >
                        {row.orderName || `Ordre ${row.orderNumber}`}
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
                        Behandl igen
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-stack>
        )}
      </s-section>

      <s-section heading="Solgt uden forudbestillingsplan">
        {withoutPlan.length === 0 ? (
          <s-paragraph>
            Alle forudbestillinger er købt som forudbestilling.
          </s-paragraph>
        ) : (
          <s-stack gap="base">
            <s-paragraph>
              {withoutPlan30 === 1 ? "1 ordre" : `${withoutPlan30} ordrer`} de
              seneste 30 dage købte en vare på forudbestilling uden at vælge
              forudbestilling — fx en kladdeordre, et salg i POS, en ordre fra
              en anden app, eller fordi PREAURA-blokken mangler på produktsiden.
              Appen har talt dem med i den aktive leverance, så varen ikke
              sælges for meget. Sker det tit, er der som regel noget galt i
              opsætningen.
            </s-paragraph>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Ordre</s-table-header>
                <s-table-header format="numeric">Antal</s-table-header>
                <s-table-header listSlot="secondary">Status</s-table-header>
                <s-table-header>Bestilt</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {withoutPlan.map((row) => (
                  <s-table-row key={row.id}>
                    <s-table-cell>
                      <s-link
                        href={`shopify://admin/orders/${row.orderNumber}`}
                      >
                        {row.orderName || `Ordre ${row.orderNumber}`}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>{row.quantity}</s-table-cell>
                    <s-table-cell>
                      {row.status === "ACTIVE"
                        ? "Tildelt"
                        : row.status === "UNRESOLVED"
                          ? "Uafklaret"
                          : "Annulleret"}
                    </s-table-cell>
                    <s-table-cell>{row.orderedAt}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-stack>
        )}
      </s-section>

      <s-section heading="Hændelser, der fejlede">
        {failed.length === 0 ? (
          <s-paragraph>Ingen fejl.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Hændelse</s-table-header>
              <s-table-header>Ordre</s-table-header>
              <s-table-header listSlot="secondary">Fejl</s-table-header>
              <s-table-header>Modtaget</s-table-header>
              <s-table-header>Handling</s-table-header>
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
                      Prøv igen
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
