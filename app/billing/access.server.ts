import {
  fetchActiveSubscription,
  type ActiveSubscription,
} from "./partnerApi.server";

// Har butikken adgang til PREAURA lige nu?
//
// PREAURA har ét abonnement, der dækker alt. Der er derfor kun to tilstande:
// butikken har et aktivt abonnement (også i prøveperioden), eller den har
// ikke. Pris og prøveperiode står kun i Partner Dashboard.
//
// Sandheden er butikkens aktive abonnement i Shopify (Partner API). Vi gemmer
// INTET om abonnementet i databasen. Svaret caches kortvarigt i hukommelsen
// (5 min, PREAURA_ENTITLEMENT_TTL_SECONDS), udløber af sig selv og kan tømmes
// med clearAccessCache — det sker, når butikken kommer tilbage fra Shopifys
// prisvalgsside. Kun et bekræftet abonnement caches; «intet abonnement»
// tjekkes igen hver gang, så en butik, der lige har tegnet abonnement, kommer
// ind med det samme.
//
// Mangler adgangen, lukkes funktionerne — intet data slettes eller nulstilles.
// Derfor må intet i app/billing/ røre databasen (håndhæves af lint og test).
//
// PREAURA_BILLING=off slår tjekket helt fra (alle har adgang). Bruges, indtil
// abonnementet er oprettet på produktionsappen i Partner Dashboard.

export type Access =
  | {
      status: "active";
      /** Null, når tjekket er slået fra. */
      subscription: ActiveSubscription | null;
    }
  | { status: "none" };

type ActiveAccess = Extract<Access, { status: "active" }>;

type CacheEntry = { access: ActiveAccess; expiresAt: number };

const cache = new Map<string, CacheEntry>();
const shopGids = new Map<string, string>();

/** Tømmer cachen for én butik, eller for alle. */
export function clearAccessCache(shop?: string) {
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
  env?: Record<string, string | undefined>;
  now?: () => number;
};

export async function resolveAccess(
  shop: string,
  {
    shopGid,
    fetchSubscription = (gid) => fetchActiveSubscription(gid),
    env = process.env,
    now = Date.now,
  }: ResolveDeps,
): Promise<Access> {
  if (!billingEnabled(env)) return { status: "active", subscription: null };

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
  const access: ActiveAccess = { status: "active", subscription };
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

const DAY = 24 * 60 * 60 * 1000;

/** Det, siden «Abonnement» viser. Ren funktion — ingen priser. */
export type SubscriptionStatus =
  | { kind: "off" }
  | { kind: "none" }
  | {
      kind: "trial";
      /** Hele dage tilbage, rundet op (1 = sidste dag). */
      daysLeft: number;
      trialEndsAt: string;
      endsAtPeriodEnd: boolean;
    }
  | { kind: "active"; endsAtPeriodEnd: boolean };

export function subscriptionStatus(
  access: Access,
  billingOn: boolean,
  now: number = Date.now(),
): SubscriptionStatus {
  if (!billingOn) return { kind: "off" };
  if (access.status !== "active") return { kind: "none" };
  const sub = access.subscription;
  const endsAtPeriodEnd = sub?.cancelAtEndOfCycle ?? false;
  const trialEnd = sub?.trialEndsAt ? Date.parse(sub.trialEndsAt) : NaN;
  if (Number.isFinite(trialEnd) && trialEnd > now) {
    return {
      kind: "trial",
      daysLeft: Math.ceil((trialEnd - now) / DAY),
      trialEndsAt: sub!.trialEndsAt!,
      endsAtPeriodEnd,
    };
  }
  return { kind: "active", endsAtPeriodEnd };
}
