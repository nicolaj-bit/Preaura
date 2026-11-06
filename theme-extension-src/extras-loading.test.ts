// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Kernen henter kun tillægget (venteliste, resttal, tidslinje), når siden kan
// bruge det. En produktside uden forudbestilling eller venteliste henter intet
// ekstra.

const SCRIPT = readFileSync(
  join(__dirname, "../extensions/preaura-preorder/assets/preaura-preorder.js"),
  "utf8",
);
const EXTRAS_URL =
  "https://cdn.shopify.com/extensions/x/preaura-preorder-extras.js";

function page(variants: Record<string, unknown>, waitlist: boolean) {
  delete (window as { __preauraCartPatched?: boolean }).__preauraCartPatched;
  document.head.innerHTML = "";
  document.body.innerHTML = `
    <form action="/cart/add"><input type="hidden" name="id" value="1"><button type="submit" name="add">Køb</button></form>
    <div data-preaura-root hidden>
      <p data-preaura-message></p>
      <script type="application/json" data-preaura-data>${JSON.stringify({
        selected: 1,
        product: 7,
        extras: EXTRAS_URL,
        locale: "da",
        settings: { waitlist },
        variants,
        available: { "1": true },
      })}</script>
    </div>`;
  new Function(SCRIPT)();
  return [...document.querySelectorAll("script[src]")].map(
    (s) => (s as HTMLScriptElement).src,
  );
}

describe("tillægget hentes kun efter behov", () => {
  it("forudbestilling på siden: tillægget hentes én gang, uden at blokere", () => {
    const scripts = page(
      {
        "1": {
          active: true,
          mode: "SHIPPING",
          date: "2026-12-01",
          sellingPlanId: "gid://shopify/SellingPlan/1",
          remaining: 3,
          soldOut: false,
        },
      },
      false,
    );
    expect(scripts).toEqual([EXTRAS_URL]);
    expect(
      (document.querySelector("script[src]") as HTMLScriptElement).defer,
    ).toBe(true);
  });

  it("venteliste slået til: tillægget hentes", () => {
    expect(page({ "1": { active: false } }, true)).toEqual([EXTRAS_URL]);
  });

  it("hverken forudbestilling eller venteliste: intet hentes", () => {
    expect(page({ "1": { active: false } }, false)).toEqual([]);
  });
});
