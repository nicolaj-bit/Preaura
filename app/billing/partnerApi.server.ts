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
  /** Sand, når butikken har opsagt, og abonnementet stopper ved periodens udgang. */
  cancelAtEndOfCycle: boolean;
  /** Hvornår prøveperioden slutter (ISO). Kan ligge i fortiden. */
  trialEndsAt: string | null;
};

/**
 * Fjerner alt, der ligner en nøgle (fx Partner API-nøgler «prtapi_…» og
 * Shopify-adgangsnøgler «shpat_…»), så en fejlbesked aldrig kan lække en
 * hemmelighed i loggen eller på skærmen — heller ikke når Shopify selv
 * gentager den i sit svar.
 */
export function redactSecrets(
  text: string,
  secrets: (string | undefined)[] = [],
) {
  let result = text.replace(
    /\b(prtapi|shpat|shpca|shpss|shppa|pk)_[A-Za-z0-9]+/g,
    "[skjult nøgle]",
  );
  for (const secret of secrets) {
    if (secret && secret.length >= 8) {
      result = result.split(secret).join("[skjult nøgle]");
    }
  }
  return result;
}

export class PartnerApiError extends Error {
  constructor(message: string) {
    super(redactSecrets(message));
    this.name = "PartnerApiError";
  }
}

const QUERY = `query PreauraActiveSubscription($appId: ID!, $shopId: ID!) {
  activeSubscription(appId: $appId, shopId: $shopId) {
    cancelAtEndOfCycle
    trialEndsAt
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
      } | null;
    };
    errors?: unknown;
  } | null;
  if (!response.ok || !json || json.errors || !json.data) {
    throw new PartnerApiError(
      redactSecrets(
        `Partner API svarede ${response.status}: ${JSON.stringify(json?.errors ?? null)}`,
        [token, orgId, appGid],
      ),
    );
  }
  const subscription = json.data.activeSubscription;
  if (!subscription) return null;
  return {
    cancelAtEndOfCycle: subscription.cancelAtEndOfCycle,
    trialEndsAt: subscription.trialEndsAt,
  };
}
