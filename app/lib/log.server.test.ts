import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  alertText,
  describeError,
  logError,
  scrub,
  sendAlert,
  setAlertFetch,
} from "./log.server";

// Opgave 17: fejllogning uden persondata, og alarmer til et menneske.

/** En fejl som den, Shopifys GraphQL-klient kaster: svaret hænger på. */
function shopifyError() {
  return Object.assign(new Error("GraphQL Client: Internal Server Error"), {
    response: {
      body: {
        data: {
          order: {
            email: "anna.jensen@example.com",
            customer: { firstName: "Anna", lastName: "Jensen" },
          },
        },
      },
    },
  });
}

describe("fejllogning", () => {
  let lines: string[] = [];
  beforeEach(() => {
    lines = [];
    for (const level of ["error", "warn", "info", "log"] as const) {
      vi.spyOn(console, level).mockImplementation((...args) => {
        lines.push(args.map(String).join(" "));
      });
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.PREAURA_ALERT_URL;
  });

  it("logger butik, handling, id'er og fejlbesked, men aldrig fejlens svar med kundens navn og e-mail", () => {
    logError(
      "Ordren kunne ikke behandles",
      {
        shop: "butik.myshopify.com",
        ids: { orderId: "gid://shopify/Order/1" },
      },
      shopifyError(),
    );
    const out = lines.join("\n");
    expect(JSON.parse(lines[0])).toEqual({
      level: "error",
      action: "Ordren kunne ikke behandles",
      shop: "butik.myshopify.com",
      ids: { orderId: "gid://shopify/Order/1" },
      error: {
        name: "Error",
        message: "GraphQL Client: Internal Server Error",
      },
    });
    expect(out).not.toContain("anna.jensen@example.com");
    expect(out).not.toContain("Anna");
    expect(out).not.toContain("Jensen");
  });

  it("fjerner e-mailadresser, der står i selve fejlbeskeden", () => {
    expect(scrub("Invalid email anna.jensen@example.com, try again")).toBe(
      "Invalid email [e-mail], try again",
    );
    expect(
      describeError(new Error("Profil kunde+tag@sub.example.dk findes ikke"))
        .message,
    ).toBe("Profil [e-mail] findes ikke");
  });

  it("ingen kode i appen skriver direkte til loggen udenom log.server.ts", () => {
    // Fanger nye console-kald, der kunne logge et fejlobjekt eller en
    // nyttelast. Tests og log.server.ts selv er undtaget.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name))
          files.push(path);
      }
    };
    walk(join(__dirname, ".."));
    const offenders = files.filter(
      (f) =>
        !f.endsWith("log.server.ts") &&
        !f.includes(`${join("app", "types")}`) &&
        !f.includes(`${join("app", "test")}`) &&
        /console\.(log|info|warn|error|debug)\(/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

describe("alarmer", () => {
  let sent: { url: string; init: RequestInit }[] = [];
  beforeEach(() => {
    sent = [];
    setAlertFetch((async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return new Response("ok");
    }) as unknown as typeof fetch);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.PREAURA_ALERT_URL;
  });

  it("sender intet, når der ikke er sat en adresse", async () => {
    expect(await sendAlert("Køen fejlede", { shop: "a.myshopify.com" })).toBe(
      false,
    );
    expect(sent).toHaveLength(0);
  });

  it("sender én besked pr. slags fejl pr. butik pr. time, uden persondata", async () => {
    process.env.PREAURA_ALERT_URL = "https://ntfy.sh/preaura-hemmeligt-emne";
    const t0 = Date.UTC(2026, 10, 17, 9);
    const context = {
      shop: "a.myshopify.com",
      ids: { orderId: "gid://shopify/Order/1" },
    };
    expect(
      await sendAlert(
        "Ordren kunne ikke behandles",
        context,
        shopifyError(),
        t0,
      ),
    ).toBe(true);
    expect(
      await sendAlert(
        "Ordren kunne ikke behandles",
        context,
        shopifyError(),
        t0 + 60_000,
      ),
    ).toBe(false);
    // En anden butik eller en anden slags fejl får sin egen besked.
    expect(
      await sendAlert(
        "Ordren kunne ikke behandles",
        { shop: "b.myshopify.com" },
        undefined,
        t0,
      ),
    ).toBe(true);
    expect(await sendAlert("Ventelisten fejlede", context, undefined, t0)).toBe(
      true,
    );
    // En time senere igen.
    expect(
      await sendAlert(
        "Ordren kunne ikke behandles",
        context,
        undefined,
        t0 + 61 * 60_000,
      ),
    ).toBe(true);
    expect(sent).toHaveLength(4);

    const body = String(sent[0].init.body);
    expect(body).toContain("a.myshopify.com");
    expect(body).toContain("gid://shopify/Order/1");
    expect(body).not.toContain("anna.jensen@example.com");
    expect(body).not.toContain("Anna");
  });

  it("Slack og Discord får JSON i det format, de forventer", async () => {
    process.env.PREAURA_ALERT_URL = "https://hooks.slack.com/services/x";
    await sendAlert("Køen fejlede", { shop: "a.myshopify.com" });
    expect(JSON.parse(String(sent[0].init.body))).toEqual({
      text: alertText("Køen fejlede", { shop: "a.myshopify.com" }),
    });
    process.env.PREAURA_ALERT_URL = "https://discord.com/api/webhooks/x";
    await sendAlert("Køen fejlede", { shop: "b.myshopify.com" });
    expect(JSON.parse(String(sent[1].init.body))).toHaveProperty("content");
  });

  it("en alarm, der ikke kan sendes, vælter ikke appen", async () => {
    process.env.PREAURA_ALERT_URL = "https://ntfy.sh/x";
    setAlertFetch((async () => {
      throw new Error("netværk nede");
    }) as unknown as typeof fetch);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(sendAlert("Køen fejlede", {})).resolves.toBe(false);
  });
});
