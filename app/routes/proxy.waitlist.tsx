import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { accessFor } from "../billing/access.server";
import { shopifySync } from "../sync/index.server";
import { waitlistFor } from "../models/waitlist.server";
import { handleSignup, senderKey } from "../waitlist/signup.server";

// Ventelisten på produktsiden: /apps/preaura/waitlist i butikken.
//
// Shopify sender kaldet videre hertil (app-proxy) og signerer det;
// authenticate.public.appProxy afviser et kald uden gyldig signatur. Kun
// POST. Svaret er JSON og er det samme, uanset om e-mailen stod på listen.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  return new Response(null, { status: 405 });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session || !admin) {
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
  const shop = session.shop;
  const form = await request.formData();
  const sync = shopifySync(admin.graphql, shop);
  const result = await handleSignup(
    shop,
    senderKey(shop, request.headers.get("x-forwarded-for")),
    {
      email: form.get("email"),
      variantId: form.get("variant_id"),
      trap: form.get("website"),
    },
    {
      hasAccess: async () => {
        try {
          return (await accessFor(admin, shop)).status === "active";
        } catch {
          // Abonnementet kunne ikke tjekkes: tag ikke imod lige nu.
          return false;
        }
      },
      productOf: async (variantId) =>
        (await sync.readVariantAvailability([variantId])).get(variantId)
          ?.productId ?? null,
      add: (input) => waitlistFor(shop).add(input),
    },
  );
  return Response.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
};
