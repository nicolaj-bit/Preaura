import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { enqueueWebhook } from "../lib/webhookQueue.server";
import { scheduleQueue } from "../orders/scheduler.server";

// inventory_levels/update: lagerændringer, også dem foretaget uden for appen.
// Verificerer HMAC, lægger hændelsen i samme kø som ordrerne og kvitterer.
// Køen afgør bagefter, om varianten skal skifte mellem lager og
// forudbestilling.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, webhookId, payload } =
    await authenticate.webhook(request);

  await enqueueWebhook({ webhookId, shop, topic, payload });
  scheduleQueue(shop);

  return new Response(null, { status: 200 });
};
