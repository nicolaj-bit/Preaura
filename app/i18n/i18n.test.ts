import { describe, expect, it } from "vitest";
import { da } from "./da";
import { en } from "./en";
import { formatDate, resolveLocale, translate, translateCount } from "./index";
import { localeFromHeaders } from "./headers";

describe("tekster på dansk og engelsk", () => {
  it("samme nøgler, ingen tomme, og de samme {variabler} på begge sprog", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(da).sort());
    const vars = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(da) as (keyof typeof da)[]) {
      expect(da[key].trim(), key).not.toBe("");
      expect(en[key].trim(), key).not.toBe("");
      expect(vars(en[key]), key).toEqual(vars(da[key]));
    }
  });

  it("tekster med tal har både «.one» og «.other»", () => {
    for (const key of Object.keys(da)) {
      if (key.endsWith(".one")) {
        expect(Object.keys(da), key).toContain(key.replace(/\.one$/, ".other"));
      }
    }
  });

  it("indsætter variabler og vælger ental/flertal", () => {
    expect(translate("en", "common.of", { done: 2, total: 5 })).toBe("2 of 5");
    expect(translateCount("da", "home.unresolved.text", 1)).toMatch(
      /^1 ordre har/,
    );
    expect(translateCount("en", "home.unresolved.text", 3)).toMatch(
      /^3 orders have/,
    );
  });

  it("datoer på sproget", () => {
    expect(formatDate("da", "2026-12-02")).toBe("2. december 2026");
    expect(formatDate("en", "2026-12-02")).toBe("December 2, 2026");
  });
});

describe("hvilket sprog", () => {
  it("dansk og engelsk genkendes i alle former; andre sprog ikke", () => {
    expect(resolveLocale("da")).toBe("da");
    expect(resolveLocale("da-DK")).toBe("da");
    expect(resolveLocale("en-GB")).toBe("en");
    expect(resolveLocale("de")).toBeNull();
    expect(resolveLocale(null)).toBeNull();
  });

  it("adressens ?locale= går forud for browserens sprog", () => {
    const request = new Request("https://app.test/app?locale=da-DK", {
      headers: { "Accept-Language": "en-US,en;q=0.9" },
    });
    expect(localeFromHeaders(request)).toBe("da");
  });

  it("uden ?locale=: browserens første sprog, appen kan", () => {
    const request = new Request("https://app.test/app", {
      headers: { "Accept-Language": "de-DE,da;q=0.8,en;q=0.5" },
    });
    expect(localeFromHeaders(request)).toBe("da");
    expect(localeFromHeaders(new Request("https://app.test/app"))).toBeNull();
  });
});

describe("gemte beskeder", () => {
  it("gemmes som nøgle og vises på sproget hos den, der ser dem", async () => {
    const { coded, localizeStored } = await import("./index");
    const stored = coded("stored.mode.received", { count: 20 });
    expect(localizeStored("da", stored)).toBe("Der kom 20 stk. på lager.");
    expect(localizeStored("en", stored)).toBe("20 units arrived in stock.");
  });

  it("Shopifys egne fejl vises uændret, og handlingen oversættes", async () => {
    const { coded, localizeStored } = await import("./index");
    const stored = coded("stored.shopifyError", {
      action: "@shopifyAction.createPlan",
      details: "Name Cannot have multiple selling plans with the same name",
    });
    expect(localizeStored("en", stored)).toBe(
      "Creating a selling plan: Name Cannot have multiple selling plans with the same name",
    );
    expect(localizeStored("da", stored)).toMatch(
      /^Oprettelse af selling plan: Name/,
    );
  });

  it("ældre beskeder på dansk og ukendte nøgler vises, som de er", async () => {
    const { localizeStored } = await import("./index");
    expect(localizeStored("en", "Varianten findes ikke i appen.")).toBe(
      "Varianten findes ikke i appen.",
    );
    expect(localizeStored("en", "i18n:ukendt.nøgle")).toBe("i18n:ukendt.nøgle");
    expect(localizeStored("en", null)).toBe("");
  });

  it("en pakket besked oversættes også (fx «Fejl: i18n:…»)", async () => {
    const { coded, localizeStored } = await import("./index");
    expect(localizeStored("en", `Error: ${coded("stored.order.gone")}`)).toBe(
      "Error: The order no longer exists in Shopify.",
    );
  });
});
