import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { enqueueWebhook } from "../lib/webhookQueue.server";
import { scheduleQueue } from "../orders/scheduler.server";

// orders/create, orders/updated, orders/cancelled og refunds/create.
// Verificerer HMAC, lægger hændelsen i kø og kvitterer. Ingen logik her —
// behandlingen startes bagefter af køen (app/orders/).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, webhookId, payload } =
    await authenticate.webhook(request);

  await enqueueWebhook({ webhookId, shop, topic, payload });
  scheduleQueue(shop);

  return new Response(null, { status: 200 });
};
