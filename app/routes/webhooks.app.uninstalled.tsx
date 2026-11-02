import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { enqueueWebhook } from "../lib/webhookQueue.server";
import db from "../db.server";

// app/uninstalled. Verificerer HMAC, lægger hændelsen i kø og kvitterer.
//
// Undtagelse fra "ingen logik": butikkens login-sessioner slettes med det
// samme, som i Shopifys skabelon. Adgangsnøglen er ugyldig fra det øjeblik,
// appen afinstalleres, og en gammel session ville spænde ben for en senere
// geninstallation.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic, webhookId, payload } =
    await authenticate.webhook(request);

  await enqueueWebhook({ webhookId, shop, topic, payload });

  // Webhooken kan komme flere gange; sessionen kan allerede være væk.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response(null, { status: 200 });
};
