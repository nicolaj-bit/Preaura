import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { enqueueWebhook } from "../lib/webhookQueue.server";
import { scheduleQueue } from "../orders/scheduler.server";

// Lovpligtige compliance-webhooks: customers/data_request,
// customers/redact og shop/redact.
//
// authenticate.webhook verificerer HMAC-signaturen og svarer selv 401,
// hvis den ikke passer. Er den gyldig, lægger vi hændelsen i kø og svarer
// 200 — også når vi ingen data har om kunden eller butikken. Selve
// sletningen og dataanmodningen sker bagefter i køen
// (app/models/compliance.server.ts).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, webhookId, payload } =
    await authenticate.webhook(request);

  await enqueueWebhook({ webhookId, shop, topic, payload });
  scheduleQueue(shop);

  return new Response(null, { status: 200 });
};
