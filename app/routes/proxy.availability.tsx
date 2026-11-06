import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { accessFor } from "../billing/access.server";
import { forShop } from "../models/preorder.server";
import { shopifySync } from "../sync/index.server";
import { liveVariant, type LiveVariant } from "../storefront/live";

// Produktsidens friske tal: /apps/preaura/availability?product_id=… i
// butikken. Hentes af app-blokken EFTER sideindlæsning, så produktsiden
// hverken venter på det eller viser et tal fra en cachet side.
//
// Svarer for alle produktets varianter på forudbestilling i ét kald, så et
// variantskift ikke kræver et nyt. Kun med aktivt abonnement — ellers et tomt
// svar, og blokken viser hverken resttal eller tidslinje.
//
// Svaret huskes i 10 sekunder pr. produkt, så en produktside med mange
// besøgende ikke giver et kald til Shopify pr. besøg.

const CACHE_MS = 10_000;
const cache = new Map<string, { at: number; body: Body }>();

type Body = { variants: Record<string, LiveVariant> };

const json = (body: Body, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session || !admin) return json({ variants: {} }, 503);
  const shop = session.shop;

  const productNumber = new URL(request.url).searchParams.get("product_id");
  if (!productNumber || !/^\d+$/.test(productNumber)) {
    return json({ variants: {} }, 400);
  }

  const key = `${shop}|${productNumber}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return json(hit.body);

  let access = false;
  try {
    access = (await accessFor(admin, shop)).status === "active";
  } catch {
    access = false;
  }
  const body: Body = { variants: {} };
  if (access) {
    const data = forShop(shop);
    const plans = (
      await data.variantPlans.listForProduct(
        `gid://shopify/Product/${productNumber}`,
      )
    ).filter((plan) => plan.preorderEnabled && plan.mode === "PREORDER");
    if (plans.length > 0) {
      const ids = plans.map((plan) => plan.variantId);
      const [deliveries, shopify] = await Promise.all([
        data.deliveries.listForVariants(ids),
        shopifySync(admin.graphql, shop)
          .readVariantAvailability(ids)
          .catch(() => null),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      for (const id of ids) {
        body.variants[id.split("/").pop()!] = liveVariant(
          deliveries.filter((d) => d.variantId === id),
          shopify?.get(id)?.quantity ?? null,
          today,
        );
      }
    }
  }
  cache.set(key, { at: Date.now(), body });
  if (cache.size > 5_000) {
    for (const [k, v] of cache) {
      if (Date.now() - v.at >= CACHE_MS) cache.delete(k);
    }
  }
  return json(body);
};
