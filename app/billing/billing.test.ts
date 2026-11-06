import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchActiveSubscription,
  PartnerApiError,
  redactSecrets,
  type ActiveSubscription,
} from "./partnerApi.server";
import {
  clearAccessCache,
  pricingPageUrl,
  resolveAccess,
  subscriptionStatus,
} from "./access.server";

const SHOP = "butik.myshopify.com";
const ON = { PREAURA_BILLING: "shopify" };
const DAY = 24 * 60 * 60 * 1000;

const sub = (over: Partial<ActiveSubscription> = {}): ActiveSubscription => ({
  cancelAtEndOfCycle: false,
  trialEndsAt: null,
  ...over,
});

beforeEach(() => clearAccessCache());

describe("ét abonnement — kun to tilstande", () => {
  const deps = (
    fetchSubscription: (gid: string) => Promise<ActiveSubscription | null>,
    now = () => 1_000,
  ) => ({
    shopGid: async () => "gid://shopify/Shop/1",
    fetchSubscription,
    env: ON,
    now,
  });

  it("aktivt abonnement → aktiv", async () => {
    const access = await resolveAccess(
      SHOP,
      deps(async () => sub()),
    );
    expect(access.status).toBe("active");
  });

  it("i prøveperioden tæller butikken som aktiv", async () => {
    const access = await resolveAccess(
      SHOP,
      deps(async () => sub({ trialEndsAt: "2030-01-01T00:00:00Z" })),
    );
    expect(access.status).toBe("active");
  });

  it("intet abonnement (udløbet prøveperiode eller opsagt) → «none», og det caches ikke", async () => {
    const fetchSub = vi.fn(async () => null);
    expect(await resolveAccess(SHOP, deps(fetchSub))).toEqual({
      status: "none",
    });
    await resolveAccess(SHOP, deps(fetchSub));
    expect(fetchSub).toHaveBeenCalledTimes(2);
  });

  it("caches kortvarigt, udløber af sig selv og kan tømmes", async () => {
    let clock = 1_000;
    const fetchSub = vi.fn(async () => sub());
    const d = deps(fetchSub, () => clock);
    await resolveAccess(SHOP, d);
    await resolveAccess(SHOP, d);
    expect(fetchSub).toHaveBeenCalledTimes(1);

    clock += 5 * 60 * 1000 + 1; // efter 5 minutter
    await resolveAccess(SHOP, d);
    expect(fetchSub).toHaveBeenCalledTimes(2);

    clearAccessCache(SHOP);
    await resolveAccess(SHOP, d);
    expect(fetchSub).toHaveBeenCalledTimes(3);
  });

  it("opsigelse slår igennem, når cachen udløber eller tømmes", async () => {
    let current: ActiveSubscription | null = sub();
    const d = deps(async () => current);
    expect((await resolveAccess(SHOP, d)).status).toBe("active");
    current = null;
    clearAccessCache(SHOP);
    expect((await resolveAccess(SHOP, d)).status).toBe("none");
  });

  it("fejler Shopify, beholder en kendt butik sin adgang — den sendes ikke til prisvalg", async () => {
    let clock = 1_000;
    let fail = false;
    const d = deps(
      async () => {
        if (fail) throw new PartnerApiError("nede");
        return sub();
      },
      () => clock,
    );
    await resolveAccess(SHOP, d);
    fail = true;
    clock += 10 * 60 * 1000;
    const access = await resolveAccess(SHOP, d);
    expect(access.status).toBe("active");
  });

  it("fejler Shopify for en ukendt butik, kastes fejlen (ingen omdirigering)", async () => {
    await expect(
      resolveAccess(
        SHOP,
        deps(async () => {
          throw new PartnerApiError("nede");
        }),
      ),
    ).rejects.toThrow(PartnerApiError);
  });

  it("PREAURA_BILLING=off: adgang, intet kald til Shopify", async () => {
    const fetchSub = vi.fn(async () => null);
    const access = await resolveAccess(SHOP, { ...deps(fetchSub), env: {} });
    expect(access.status).toBe("active");
    expect(fetchSub).not.toHaveBeenCalled();
  });
});

describe("prisvalgssiden", () => {
  it("peger på Shopifys side for butikken og appen", () => {
    expect(pricingPageUrl(SHOP, "preaura")).toBe(
      "https://admin.shopify.com/store/butik/charges/preaura/pricing_plans",
    );
  });
});

describe("Partner API", () => {
  const env = {
    SHOPIFY_PARTNER_ORG_ID: "123",
    SHOPIFY_PARTNER_API_ACCESS_TOKEN: "hemmelig",
    SHOPIFY_APP_GID: "gid://shopify/App/9",
  };

  it("spørger på butikkens abonnement for netop denne app og læser prøveperiode og opsigelse", async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const fetchFn = (async (url: string, init: RequestInit) => {
      request = { url, init };
      return new Response(
        JSON.stringify({
          data: {
            activeSubscription: {
              cancelAtEndOfCycle: true,
              trialEndsAt: "2026-11-20T00:00:00Z",
            },
          },
        }),
      );
    }) as unknown as typeof fetch;
    const sub = await fetchActiveSubscription("gid://shopify/Shop/1", {
      fetchFn,
      env,
    });
    expect(sub).toEqual({
      cancelAtEndOfCycle: true,
      trialEndsAt: "2026-11-20T00:00:00Z",
    });
    expect(request!.url).toBe(
      "https://partners.shopify.com/123/api/2026-10/graphql.json",
    );
    expect(
      (request!.init.headers as Record<string, string>)[
        "X-Shopify-Access-Token"
      ],
    ).toBe("hemmelig");
    expect(JSON.parse(String(request!.init.body)).variables).toEqual({
      appId: "gid://shopify/App/9",
      shopId: "gid://shopify/Shop/1",
    });
  });

  it("en fejlbesked kan aldrig vise en nøgle — heller ikke når Shopify gentager den", async () => {
    // Det, der skete i testmiljøet: nøglen stod i SHOPIFY_APP_GID, og
    // Shopify gentog den i sin fejlbesked.
    const echoing = (async (_url: string, init: RequestInit) => {
      const appId = JSON.parse(String(init.body)).variables.appId;
      return new Response(
        JSON.stringify({
          errors: [
            {
              message: `Invalid GID '${appId}'`,
              extensions: { code: "INVALID_GID" },
            },
          ],
        }),
      );
    }) as unknown as typeof fetch;
    const error = (await fetchActiveSubscription("g", {
      fetchFn: echoing,
      env: { ...env, SHOPIFY_APP_GID: "prtapi_abc123def456" },
    }).catch((e: Error) => e)) as Error;
    expect(error).toBeInstanceOf(PartnerApiError);
    expect(error.message).not.toContain("prtapi_abc123def456");
    expect(error.message).toContain("INVALID_GID");
    expect(redactSecrets("token shpat_XYZ123 og pk_abc987", [])).toBe(
      "token [skjult nøgle] og [skjult nøgle]",
    );
  });

  it("null betyder intet abonnement; fejl kastes", async () => {
    const ok = (async () =>
      new Response(
        JSON.stringify({ data: { activeSubscription: null } }),
      )) as unknown as typeof fetch;
    expect(await fetchActiveSubscription("g", { fetchFn: ok, env })).toBeNull();
    const throttled = (async () =>
      new Response(JSON.stringify({ errors: [{ message: "Throttled" }] }), {
        status: 429,
      })) as unknown as typeof fetch;
    await expect(
      fetchActiveSubscription("g", { fetchFn: throttled, env }),
    ).rejects.toThrow(PartnerApiError);
    await expect(fetchActiveSubscription("g", { env: {} })).rejects.toThrow(
      PartnerApiError,
    );
  });
});

describe("nedgradering og opsigelse rører aldrig data", () => {
  it("intet i app/billing/ henter databasen eller datalaget", () => {
    const dir = __dirname;
    const sources = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => readFileSync(join(dir, f), "utf8"));
    for (const source of sources) {
      expect(source).not.toMatch(
        /db\.server|\/models\/|@prisma\/client|\/sync\/|\/orders\/|\/events\//,
      );
      // Ingen databaseklient (db, client, tx, prisma) bruges.
      expect(source).not.toMatch(/\b(db|client|tx|prisma)\.\w+/);
    }
  });
});

describe("nedgradering og opsigelse rører aldrig data", () => {
  it("intet i app/billing/ henter databasen eller datalaget", () => {
    const dir = __dirname;
    const sources = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => readFileSync(join(dir, f), "utf8"));
    for (const source of sources) {
      expect(source).not.toMatch(
        /db\.server|\/models\/|@prisma\/client|\/sync\/|\/orders\/|\/events\//,
      );
      // Ingen databaseklient (db, client, tx, prisma) bruges.
      expect(source).not.toMatch(/\b(db|client|tx|prisma)\.\w+/);
    }
  });

  it("der er ingen planer tilbage — hverken nøgler, konfiguration eller grænser", () => {
    const dir = __dirname;
    const files = readdirSync(dir);
    expect(files).not.toContain("plans.ts");
    for (const f of files.filter((f) => !f.endsWith(".test.ts"))) {
      const source = readFileSync(join(dir, f), "utf8");
      expect(source).not.toMatch(
        /gratis|basis|\bpro\b|PREAURA_PLANS_JSON|requireFeature/,
      );
    }
  });
});

describe("siden Abonnement", () => {
  const NOW = Date.parse("2026-11-06T12:00:00Z");
  const active = (s: ActiveSubscription) =>
    ({ status: "active", subscription: s }) as const;

  it("prøveperiode: viser dage tilbage, rundet op", () => {
    const status = subscriptionStatus(
      active(sub({ trialEndsAt: new Date(NOW + 13.5 * DAY).toISOString() })),
      true,
      NOW,
    );
    expect(status).toMatchObject({ kind: "trial", daysLeft: 14 });
    const last = subscriptionStatus(
      active(
        sub({ trialEndsAt: new Date(NOW + 2 * 60 * 60 * 1000).toISOString() }),
      ),
      true,
      NOW,
    );
    expect(last).toMatchObject({ kind: "trial", daysLeft: 1 });
  });

  it("efter prøveperioden: aktiv", () => {
    const status = subscriptionStatus(
      active(sub({ trialEndsAt: new Date(NOW - DAY).toISOString() })),
      true,
      NOW,
    );
    expect(status).toEqual({ kind: "active", endsAtPeriodEnd: false });
  });

  it("viser, når abonnementet er opsagt og stopper ved periodens udgang", () => {
    expect(
      subscriptionStatus(active(sub({ cancelAtEndOfCycle: true })), true, NOW),
    ).toEqual({ kind: "active", endsAtPeriodEnd: true });
  });

  it("slået fra, eller intet abonnement — og aldrig en pris", () => {
    expect(subscriptionStatus({ status: "none" }, false, NOW)).toEqual({
      kind: "off",
    });
    expect(subscriptionStatus({ status: "none" }, true, NOW)).toEqual({
      kind: "none",
    });
    expect(
      JSON.stringify(subscriptionStatus(active(sub()), true, NOW)),
    ).not.toMatch(/kr|\$|USD|DKK|39/);
  });
});
