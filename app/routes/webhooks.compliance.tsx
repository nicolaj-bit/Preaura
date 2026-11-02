import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { enqueueWebhook } from "../lib/webhookQueue.server";

// Lovpligtige compliance-webhooks: customers/data_request,
// customers/redact og shop/redact.
//
// authenticate.webhook verificerer HMAC-signaturen og svarer selv 401,
// hvis den ikke passer. Er den gyldig, lægger vi hændelsen i kø og svarer
// 200 — også når vi ingen data har om kunden eller butikken.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, webhookId, payload } =
    await authenticate.webhook(request);

  await enqueueWebhook({ webhookId, shop, topic, payload });

  return new Response(null, { status: 200 });
};
