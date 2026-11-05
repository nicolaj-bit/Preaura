// Butikkens aktive abonnement, læst fra Shopify (Partner API). Med Shopify
// App Pricing kommer abonnementet herfra — ikke fra Admin API, og ikke fra
// vores egen database.
//
// Miljøvariabler (aldrig i repoet):
//   SHOPIFY_PARTNER_ORG_ID            Partner-id (tallet i Partner Dashboards URL)
//   SHOPIFY_PARTNER_API_ACCESS_TOKEN  Adgangsnøgle til en Partner API-klient
//                                     med tilladelsen «Manage apps»
//   SHOPIFY_APP_GID                   gid://shopify/App/<id> for netop denne app

export const PARTNER_API_VERSION = "2026-10";

export type ActiveSubscription = {
  /** Plan-handles i abonnementet (fx «basis»). */
  handles: string[];
  cancelAtEndOfCycle: boolean;
  trialEndsAt: string | null;
};

export class PartnerApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PartnerApiError";
  }
}

const QUERY = `query PreauraActiveSubscription($appId: ID!, $shopId: ID!) {
  activeSubscription(appId: $appId, shopId: $shopId) {
    cancelAtEndOfCycle
    trialEndsAt
    items {
      handle
    }
  }
}`;

/**
 * Null: butikken har intet aktivt abonnement. Kaster ved enhver anden fejl
 * (fx Partner API nede eller begrænset) — så en betalende butik aldrig
 * sendes til prisvalgssiden, fordi et kald fejlede.
 */
export async function fetchActiveSubscription(
  shopGid: string,
  {
    fetchFn = fetch,
    env = process.env,
  }: {
    fetchFn?: typeof fetch;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<ActiveSubscription | null> {
  const orgId = env.SHOPIFY_PARTNER_ORG_ID;
  const token = env.SHOPIFY_PARTNER_API_ACCESS_TOKEN;
  const appGid = env.SHOPIFY_APP_GID;
  if (!orgId || !token || !appGid) {
    throw new PartnerApiError(
      "Abonnementet kan ikke tjekkes: SHOPIFY_PARTNER_ORG_ID, SHOPIFY_PARTNER_API_ACCESS_TOKEN og SHOPIFY_APP_GID skal være sat.",
    );
  }
  let response: Response;
  try {
    response = await fetchFn(
      `https://partners.shopify.com/${orgId}/api/${PARTNER_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({
          query: QUERY,
          variables: { appId: appGid, shopId: shopGid },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch (error) {
    throw new PartnerApiError(
      `Partner API kunne ikke nås: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const json = (await response.json().catch(() => null)) as {
    data?: {
      activeSubscription: {
        cancelAtEndOfCycle: boolean;
        trialEndsAt: string | null;
        items: { handle: string | null }[];
      } | null;
    };
    errors?: unknown;
  } | null;
  if (!response.ok || !json || json.errors || !json.data) {
    throw new PartnerApiError(
      `Partner API svarede ${response.status}: ${JSON.stringify(json?.errors ?? null)}`,
    );
  }
  const subscription = json.data.activeSubscription;
  if (!subscription) return null;
  return {
    handles: subscription.items
      .map((item) => item.handle)
      .filter((h): h is string => !!h),
    cancelAtEndOfCycle: subscription.cancelAtEndOfCycle,
    trialEndsAt: subscription.trialEndsAt,
  };
}
