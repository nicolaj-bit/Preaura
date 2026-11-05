import {
  can,
  entitlementFor,
  loadPlansConfig,
  planForHandles,
  unrestricted,
  type Entitlement,
  type Feature,
  type PlansConfig,
} from "./plans";
import {
  fetchActiveSubscription,
  type ActiveSubscription,
} from "./partnerApi.server";

// Hvad butikken har adgang til lige nu.
//
// Sandheden er butikkens aktive abonnement i Shopify (Partner API). Vi gemmer
// INTET om planen i databasen. Svaret caches kortvarigt i hukommelsen (5 min,
// PREAURA_ENTITLEMENT_TTL_SECONDS), udløber af sig selv og kan tømmes med
// clearEntitlementCache — det sker, når butikken kommer tilbage fra Shopifys
// prisvalgsside. Kun et bekræftet abonnement caches; «intet abonnement» tjekkes
// igen hver gang, så en butik, der lige har valgt plan, kommer ind med det samme.
//
// PREAURA_BILLING=off slår tjekket fra (alle funktioner). Bruges, indtil
// planerne er oprettet i Partner Dashboard.

export type Access =
  | {
      status: "active";
      entitlement: Entitlement;
      subscription: ActiveSubscription | null;
    }
  | { status: "none" };

type CacheEntry = {
  access: Extract<Access, { status: "active" }>;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const shopGids = new Map<string, string>();

/** Tømmer cachen for én butik, eller for alle. */
export function clearEntitlementCache(shop?: string) {
  if (shop) cache.delete(shop);
  else cache.clear();
}

export function billingEnabled(
  env: Record<string, string | undefined> = process.env,
) {
  return (env.PREAURA_BILLING ?? "off") !== "off";
}

function ttlMs(env: Record<string, string | undefined>) {
  const seconds = Number(env.PREAURA_ENTITLEMENT_TTL_SECONDS ?? 300);
  return (Number.isFinite(seconds) && seconds >= 0 ? seconds : 300) * 1000;
}

export type ResolveDeps = {
  /** Butikkens gid (gid://shopify/Shop/…), som Partner API kræver. */
  shopGid: () => Promise<string>;
  fetchSubscription?: (shopGid: string) => Promise<ActiveSubscription | null>;
  config?: PlansConfig;
  env?: Record<string, string | undefined>;
  now?: () => number;
};

export async function resolveAccess(
  shop: string,
  {
    shopGid,
    fetchSubscription = (gid) => fetchActiveSubscription(gid),
    config = loadPlansConfig(),
    env = process.env,
    now = Date.now,
  }: ResolveDeps,
): Promise<Access> {
  if (!billingEnabled(env)) {
    return {
      status: "active",
      entitlement: unrestricted(),
      subscription: null,
    };
  }
  const cached = cache.get(shop);
  if (cached && cached.expiresAt > now()) return cached.access;

  let gid = shopGids.get(shop);
  let subscription: ActiveSubscription | null;
  try {
    if (!gid) {
      gid = await shopGid();
      shopGids.set(shop, gid);
    }
    subscription = await fetchSubscription(gid);
  } catch (error) {
    // Shopify kunne ikke svare. En butik, vi for nylig har set med
    // abonnement, beholder sin adgang — den sendes aldrig til prisvalgssiden,
    // fordi et kald fejlede.
    if (cached) {
      console.error(`Abonnementet for ${shop} kunne ikke tjekkes:`, error);
      return cached.access;
    }
    throw error;
  }
  if (!subscription) {
    cache.delete(shop);
    return { status: "none" };
  }
  const access = {
    status: "active" as const,
    entitlement: entitlementFor(
      config,
      planForHandles(config, subscription.handles),
    ),
    subscription,
  };
  cache.set(shop, { access, expiresAt: now() + ttlMs(env) });
  return access;
}

/**
 * Shopifys prisvalgsside for appen. Skal åbnes med target "_top", så den
 * forlader app-rammen (iframen) i Shopify Admin.
 */
export function pricingPageUrl(
  shop: string,
  appHandle: string | undefined = process.env.PREAURA_APP_HANDLE,
) {
  if (!appHandle) {
    throw new Error(
      "PREAURA_APP_HANDLE mangler (appens handle fra Partner Dashboard).",
    );
  }
  const storeHandle = shop.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;
}

export class FeatureNotIncludedError extends Response {
  constructor(feature: Feature) {
    super(`Din plan giver ikke adgang til «${feature}».`, { status: 403 });
  }
}

/**
 * ÉN kontrol pr. funktion. Kaldes i en loader eller action:
 *
 *   const access = await accessFor(admin, session.shop);
 *   requireFeature(access, "events.klaviyo");
 *
 * Kaster et 403-svar, hvis planen ikke giver adgang. Rører aldrig data.
 */
export function requireFeature(access: Access, feature: Feature) {
  if (access.status !== "active" || !can(access.entitlement, feature)) {
    throw new FeatureNotIncludedError(feature);
  }
}

type AdminGraphql = (query: string) => Promise<Response>;

/** Adgangen for en butik ud fra en godkendt admin-session. */
export function accessFor(admin: { graphql: AdminGraphql }, shop: string) {
  return resolveAccess(shop, {
    shopGid: async () => {
      const response = await admin.graphql(`#graphql
        query PreauraShopId {
          shop {
            id
          }
        }`);
      const json = (await response.json()) as {
        data: { shop: { id: string } };
      };
      return json.data.shop.id;
    },
  });
}
