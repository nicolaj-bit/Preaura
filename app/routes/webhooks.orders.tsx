import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { enqueueWebhook } from "../lib/webhookQueue.server";

// orders/create, orders/updated og orders/cancelled.
// Verificerer HMAC, lægger hændelsen i kø og kvitterer. Ingen logik her.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, webhookId, payload } =
    await authenticate.webhook(request);

  await enqueueWebhook({ webhookId, shop, topic, payload });

  return new Response(null, { status: 200 });
};
