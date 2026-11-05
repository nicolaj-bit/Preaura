import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  can,
  limitOf,
  loadPlansConfig,
  parsePlansConfig,
  planForHandles,
  PlansConfigError,
} from "./plans";
import {
  fetchActiveSubscription,
  PartnerApiError,
  redactSecrets,
} from "./partnerApi.server";
import {
  clearEntitlementCache,
  FeatureNotIncludedError,
  pricingPageUrl,
  requireFeature,
  resolveAccess,
} from "./entitlements.server";

const SHOP = "butik.myshopify.com";
const ON = { PREAURA_BILLING: "shopify" };

const config = parsePlansConfig({
  plans: {
    gratis: { features: ["preorders"], limits: { preorderVariants: 5 } },
    basis: {
      features: ["preorders", "events.flow"],
      limits: { preorderVariants: 50 },
    },
    pro: {
      features: [
        "preorders",
        "events.flow",
        "events.webhook",
        "events.klaviyo",
      ],
      limits: { preorderVariants: null },
    },
  },
  shopifyHandles: { gratis: "gratis", "basis-maaned": "basis", pro: "pro" },
  unknownHandlePlan: "pro",
});

beforeEach(() => clearEntitlementCache());

describe("plankonfigurationen", () => {
  it("filen i config/plans.json er gyldig og har gratis, basis og pro", () => {
    const loaded = loadPlansConfig({});
    expect(Object.keys(loaded.plans).sort()).toEqual([
      "basis",
      "gratis",
      "pro",
    ]);
  });

  it("kan overstyres med PREAURA_PLANS_JSON — uden at røre koden", () => {
    const loaded = loadPlansConfig({
      PREAURA_PLANS_JSON: JSON.stringify({
        plans: { solo: { features: ["preorders"], limits: {} } },
        shopifyHandles: { solo: "solo" },
        unknownHandlePlan: "solo",
      }),
    });
    expect(Object.keys(loaded.plans)).toEqual(["solo"]);
  });

  it("afviser stavefejl i funktioner og handles, der peger på ukendte planer", () => {
    expect(() =>
      parsePlansConfig({
        plans: { gratis: { features: ["preorder"] } },
        shopifyHandles: {},
        unknownHandlePlan: "gratis",
      }),
    ).toThrow(PlansConfigError);
    expect(() =>
      parsePlansConfig({
        plans: { gratis: { features: [] } },
        shopifyHandles: { x: "guld" },
        unknownHandlePlan: "gratis",
      }),
    ).toThrow(PlansConfigError);
  });

  it("arbejder med plannøgler via handles — ikke navne eller priser", () => {
    expect(planForHandles(config, ["basis-maaned"])).toBe("basis");
    // En handle, vi ikke kender: til fordel for butikken.
    expect(planForHandles(config, ["noget-nyt"])).toBe("pro");
  });
});

describe("adgang læses fra Shopify", () => {
  const deps = (
    fetchSubscription: (gid: string) => Promise<{ handles: string[] } | null>,
    now = () => 1_000,
  ) => ({
    shopGid: async () => "gid://shopify/Shop/1",
    fetchSubscription: async (gid: string) => {
      const sub = await fetchSubscription(gid);
      return sub && { ...sub, cancelAtEndOfCycle: false, trialEndsAt: null };
    },
    config,
    env: ON,
    now,
  });

  it("aktiv plan giver dens funktioner og grænser", async () => {
    const access = await resolveAccess(
      SHOP,
      deps(async () => ({ handles: ["basis-maaned"] })),
    );
    expect(access.status).toBe("active");
    if (access.status !== "active") return;
    expect(access.entitlement.plan).toBe("basis");
    expect(can(access.entitlement, "events.flow")).toBe(true);
    expect(can(access.entitlement, "events.klaviyo")).toBe(false);
    expect(limitOf(access.entitlement, "preorderVariants")).toBe(50);
  });

  it("intet abonnement → status «none» (og det caches ikke)", async () => {
    const fetchSub = vi.fn(async () => null);
    expect(await resolveAccess(SHOP, deps(fetchSub))).toEqual({
      status: "none",
    });
    await resolveAccess(SHOP, deps(fetchSub));
    expect(fetchSub).toHaveBeenCalledTimes(2);
  });

  it("caches kortvarigt, udløber af sig selv og kan tømmes", async () => {
    let clock = 1_000;
    const fetchSub = vi.fn(async () => ({ handles: ["pro"] }));
    const d = deps(fetchSub, () => clock);
    await resolveAccess(SHOP, d);
    await resolveAccess(SHOP, d);
    expect(fetchSub).toHaveBeenCalledTimes(1);

    clock += 5 * 60 * 1000 + 1; // efter 5 minutter
    await resolveAccess(SHOP, d);
    expect(fetchSub).toHaveBeenCalledTimes(2);

    clearEntitlementCache(SHOP);
    await resolveAccess(SHOP, d);
    expect(fetchSub).toHaveBeenCalledTimes(3);
  });

  it("nedgradering slår igennem, når cachen udløber eller tømmes", async () => {
    let handles = ["pro"];
    const d = deps(async () => ({ handles }));
    await resolveAccess(SHOP, d);
    handles = ["gratis"];
    clearEntitlementCache(SHOP);
    const access = await resolveAccess(SHOP, d);
    expect(access.status === "active" && access.entitlement.plan).toBe(
      "gratis",
    );
  });

  it("fejler Shopify, beholder en kendt butik sin adgang — den sendes ikke til prisvalg", async () => {
    let clock = 1_000;
    let fail = false;
    const d = deps(
      async () => {
        if (fail) throw new PartnerApiError("nede");
        return { handles: ["pro"] };
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

  it("PREAURA_BILLING=off: alle funktioner, intet kald til Shopify", async () => {
    const fetchSub = vi.fn(async () => null);
    const access = await resolveAccess(SHOP, { ...deps(fetchSub), env: {} });
    expect(access.status).toBe("active");
    expect(fetchSub).not.toHaveBeenCalled();
  });
});

describe("én kontrol pr. funktion", () => {
  it("requireFeature kaster 403, når planen ikke giver adgang", async () => {
    const access = await resolveAccess(SHOP, {
      shopGid: async () => "gid://shopify/Shop/1",
      fetchSubscription: async () => ({
        handles: ["gratis"],
        cancelAtEndOfCycle: false,
        trialEndsAt: null,
      }),
      config,
      env: ON,
    });
    expect(() => requireFeature(access, "preorders")).not.toThrow();
    let thrown: unknown;
    try {
      requireFeature(access, "events.klaviyo");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FeatureNotIncludedError);
    expect((thrown as Response).status).toBe(403);
    expect(() => requireFeature({ status: "none" }, "preorders")).toThrow();
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

  it("spørger på butikkens abonnement for netop denne app og læser handles", async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const fetchFn = (async (url: string, init: RequestInit) => {
      request = { url, init };
      return new Response(
        JSON.stringify({
          data: {
            activeSubscription: {
              cancelAtEndOfCycle: true,
              trialEndsAt: null,
              items: [{ handle: "basis-maaned" }],
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
      handles: ["basis-maaned"],
      cancelAtEndOfCycle: true,
      trialEndsAt: null,
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
