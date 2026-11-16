import { describe, expect, it } from "vitest";
import { blockStatus, setupSteps, themeBlockUrl } from "./setup";

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
    expect(guide.total).toBe(4);
    expect(guide.next).toBe("delivery");
    expect(guide.complete).toBe(false);
  });

  it("færdig, når alt er gjort — også blokken", () => {
    const all = { hasProducts: true, hasDelivery: true, hasEnabled: true };
    expect(setupSteps({ ...all, block: "active" }).complete).toBe(true);
    expect(setupSteps({ ...all, block: "unknown" }).complete).toBe(false);
  });
});
