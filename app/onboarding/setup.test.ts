import { coded } from "../i18n";
import { describe, expect, it } from "vitest";
import {
  blockStatus,
  cartEmbedUrl,
  describeBlock,
  setupSteps,
  themeBlockUrl,
} from "./setup";

describe("er blokken aktiv i det udgivne tema?", () => {
  const ext = (activations: { handle?: string; status?: string }[]) => [
    { handle: "preaura-flow-created", type: "ui_extension", activations: [] },
    { handle: "preaura-preorder", type: "theme_app_extension", activations },
  ];

  it("aktiv, når Shopify melder blokken aktiv", () => {
    expect(blockStatus(ext([{ handle: "preorder", status: "active" }]))).toBe(
      "active",
    );
  });

  it("ikke aktiv, når blokken kun er tilgængelig eller slet ikke er sat ind", () => {
    expect(
      blockStatus(ext([{ handle: "preorder", status: "available" }])),
    ).toBe("inactive");
    expect(blockStatus(ext([]))).toBe("inactive");
  });

  it("ukendt, når Shopify ikke kan svare — så siger appen intet forkert", () => {
    expect(blockStatus(null)).toBe("unknown");
    expect(blockStatus([])).toBe("unknown");
  });
});

describe("dybt link til temaeditoren", () => {
  it("åbner produktskabelonen med blokken klar i produktsektionen", () => {
    const url = new URL(
      themeBlockUrl("abc123").replace("shopify://", "https://"),
    );
    expect(url.pathname).toBe("/themes/current/editor");
    expect(url.searchParams.get("template")).toBe("product");
    expect(url.searchParams.get("addAppBlockId")).toBe("abc123/preorder");
    expect(url.searchParams.get("target")).toBe("mainSection");
  });
});

describe("opsætningsguiden", () => {
  it("tæller trin og peger på det næste, der mangler", () => {
    const guide = setupSteps({
      hasProducts: true,
      hasDelivery: false,
      hasEnabled: false,
      block: "inactive",
    });
    expect(guide.done).toBe(1);
    expect(guide.total).toBe(5);
    expect(guide.next).toBe("delivery");
    expect(guide.complete).toBe(false);
  });

  it("færdig, når alt er gjort — også blokken og kurven", () => {
    const all = { hasProducts: true, hasDelivery: true, hasEnabled: true };
    expect(
      setupSteps({ ...all, block: "active", cart: "active" }).complete,
    ).toBe(true);
    expect(
      setupSteps({ ...all, block: "unknown", cart: "active" }).complete,
    ).toBe(false);
    const noCart = setupSteps({ ...all, block: "active", cart: "inactive" });
    expect(noCart.complete).toBe(false);
    expect(noCart.next).toBe("cart");
  });
});

describe("når Shopify ikke kan svare", () => {
  it("genkender blokken, selv om udvidelsen meldes under et andet navn", () => {
    expect(
      blockStatus([
        {
          handle: "preaura-forudbestilling",
          type: "theme_app_extension",
          activations: [{ handle: "preorder", status: "active" }],
        },
      ]),
    ).toBe("active");
  });

  it("giver en kort teknisk forklaring", () => {
    expect(describeBlock(undefined)).toEqual({
      status: "unknown",
      reason: coded("setupReason.noAnswer"),
    });
    expect(
      describeBlock([{ handle: "x", type: "ui_extension", activations: [] }])
        .reason,
    ).toMatch(/setupReason\.noThemeExtension/);
  });

  it("butikken kan selv bekræfte — men kun når Shopify ikke ved det", () => {
    const all = { hasProducts: true, hasDelivery: true, hasEnabled: true };
    expect(
      setupSteps({
        ...all,
        block: "unknown",
        blockConfirmed: true,
        cart: "unknown",
        cartConfirmed: true,
      }).complete,
    ).toBe(true);
    expect(
      setupSteps({
        ...all,
        block: "inactive",
        blockConfirmed: true,
        cart: "active",
      }).complete,
    ).toBe(false);
    expect(
      setupSteps({
        ...all,
        block: "active",
        cart: "inactive",
        cartConfirmed: true,
      }).complete,
    ).toBe(false);
  });
});

describe("kurvens app embed", () => {
  const ext = (activations: { handle?: string; status?: string }[]) => [
    { handle: "preaura-preorder", type: "theme_app_extension", activations },
  ];

  it("læses for sig, uafhængigt af produktsidens blok", () => {
    const both = ext([
      { handle: "preorder", status: "active" },
      { handle: "cart", status: "available" },
    ]);
    expect(describeBlock(both).status).toBe("active");
    expect(describeBlock(both, "cart").status).toBe("inactive");
    expect(
      describeBlock(ext([{ handle: "cart", status: "active" }]), "cart").status,
    ).toBe("active");
  });

  it("dybt link slår embed'en til under App-integrationer", () => {
    const url = new URL(
      cartEmbedUrl("abc123").replace("shopify://", "https://"),
    );
    expect(url.pathname).toBe("/themes/current/editor");
    expect(url.searchParams.get("context")).toBe("apps");
    expect(url.searchParams.get("activateAppId")).toBe("abc123/cart");
  });
});
