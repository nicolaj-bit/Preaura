// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Resttal og tidslinje i app-blokken: hentes frisk EFTER sideindlæsning, og
// siden følger med, hvis leverancen bliver udsolgt.

const SCRIPT = readFileSync(
  join(__dirname, "../extensions/preaura-preorder/assets/preaura-preorder.js"),
  "utf8",
);
// Tillægget (venteliste, resttal, tidslinje), som kernen ellers henter selv.
const EXTRAS = readFileSync(
  join(
    __dirname,
    "../extensions/preaura-preorder/assets/preaura-preorder-extras.js",
  ),
  "utf8",
);

const PLAN_1 = "gid://shopify/SellingPlan/111";
const PLAN_2 = "gid://shopify/SellingPlan/222";

const settings = {
  shippingLabel: "Forventet afsendelse",
  deliveryLabel: "Forventet levering",
  message: "{label}: {dato}",
  soldOutMessage: "Udsolgt – alle leverancer er udsolgt.",
  changeButtonText: false,
  buttonText: "Forudbestil",
  showRemaining: true,
  remainingThreshold: 25,
  remainingText: "Kun {antal} tilbage i denne leverance.",
  timeline: true,
  timelineSoldOut: "udsolgt",
  timelineCurrent: "du køber ind i denne leverance",
  timelineUpcoming: "kommende",
  waitlist: false,
};

const cached = {
  active: true,
  mode: "SHIPPING",
  date: "2026-12-01",
  sellingPlanId: PLAN_1,
  remaining: 999,
  soldOut: false,
};

type Live = Record<string, unknown>;

function page(live: Live | null, extra: Record<string, unknown> = {}) {
  const calls: string[] = [];
  let response = live;
  const spy = vi.fn(async (url: string) => {
    calls.push(url);
    if (response === null) throw new Error("netværk");
    return new Response(JSON.stringify({ variants: response }));
  });
  window.fetch = spy as unknown as typeof fetch;
  document.body.innerHTML = `
    <div class="shopify-section">
      <form action="/cart/add" method="post" data-theme-form>
        <input type="hidden" name="id" value="1">
        <button type="submit" name="add"><span>Læg i kurv</span></button>
      </form>
      <div data-preaura-root hidden>
        <p data-preaura-message></p>
        <p data-preaura-remaining hidden></p>
        <div data-preaura-timeline hidden>
          <p id="t" data-preaura-timeline-heading></p>
          <ol aria-labelledby="t" data-preaura-timeline-list></ol>
        </div>
        <script type="application/json" data-preaura-data>${JSON.stringify({
          selected: 1,
          product: 77,
          locale: "da",
          settings: { ...settings, ...extra },
          variants: { "1": cached },
          available: { "1": true },
        })}</script>
      </div>
    </div>`;
  new Function(SCRIPT)();
  new Function(EXTRAS)();
  const root = document.querySelector("[data-preaura-root]") as HTMLElement;
  const form = document.querySelector("form") as HTMLFormElement;
  return {
    calls,
    spy,
    root,
    form,
    setResponse(next: Live | null) {
      response = next;
    },
    message: () => root.querySelector("[data-preaura-message]")!.textContent,
    remaining: () =>
      root.querySelector("[data-preaura-remaining]") as HTMLElement,
    timeline: () =>
      root.querySelector("[data-preaura-timeline]") as HTMLElement,
    items: () =>
      [...root.querySelectorAll("[data-preaura-timeline-list] li")].map(
        (li) => li.textContent,
      ),
    button: () => form.querySelector("button") as HTMLButtonElement,
    fields: () =>
      Object.fromEntries(
        [...form.querySelectorAll("[data-preaura-field]")].map((el) => [
          (el as HTMLInputElement).name,
          (el as HTMLInputElement).value,
        ]),
      ),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 300));

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { __preauraCartPatched?: boolean }).__preauraCartPatched;
});

describe("hentes efter sideindlæsning", () => {
  it("siden vises med det samme; tallet kommer bagefter i ét kald for produktet", async () => {
    const p = page({
      "1": {
        current: { date: "2026-12-01", sellingPlanId: PLAN_1, remaining: 12 },
        timeline: [{ date: "2026-12-01", state: "CURRENT" }],
      },
    });
    // Ingen ventetid på kaldet: beskeden står der allerede.
    expect(p.message()).toBe("Forventet afsendelse: 1. december 2026");
    expect(p.calls).toEqual([]);
    expect(p.remaining().hidden).toBe(true);
    await settle();
    expect(p.calls).toEqual(["/apps/preaura/availability?product_id=77"]);
    expect(p.remaining().hidden).toBe(false);
    expect(p.remaining().textContent).toBe("Kun 12 tilbage i denne leverance.");
  });

  it("sidens cachede tal vises aldrig — uden svar hverken tal eller tidslinje", async () => {
    const p = page(null);
    await settle();
    expect(p.remaining().hidden).toBe(true);
    expect(p.timeline().hidden).toBe(true);
    const visible = [...p.root.querySelectorAll("p, li")]
      .filter((el) => !(el as HTMLElement).closest("[hidden]"))
      .map((el) => el.textContent)
      .join(" ");
    expect(visible).not.toContain("999");
    // Forudbestillingen virker som før.
    expect(p.fields()).toMatchObject({ selling_plan: "111" });
  });
});

describe("grænse og til/fra", () => {
  it("over grænsen vises intet tal", async () => {
    const p = page({
      "1": {
        current: { date: "2026-12-01", sellingPlanId: PLAN_1, remaining: 480 },
        timeline: [],
      },
    });
    await settle();
    expect(p.remaining().hidden).toBe(true);
  });

  it("slået fra i blokken: intet tal", async () => {
    const p = page(
      {
        "1": {
          current: { date: "2026-12-01", sellingPlanId: PLAN_1, remaining: 3 },
          timeline: [],
        },
      },
      { showRemaining: false },
    );
    await settle();
    expect(p.remaining().hidden).toBe(true);
  });

  it("ukendt tal (null) vises ikke", async () => {
    const p = page({
      "1": {
        current: { date: "2026-12-01", sellingPlanId: PLAN_1, remaining: null },
        timeline: [],
      },
    });
    await settle();
    expect(p.remaining().hidden).toBe(true);
  });
});

describe("tidslinje", () => {
  it("datoer og tilstand som almindelig tekst i en liste — forventet, uden antal", async () => {
    const p = page({
      "1": {
        current: { date: "2027-01-15", sellingPlanId: PLAN_2, remaining: 12 },
        timeline: [
          { date: "2026-12-01", state: "SOLD_OUT" },
          { date: "2027-01-15", state: "CURRENT" },
          { date: "2027-03-01", state: "UPCOMING" },
        ],
      },
    });
    await settle();
    expect(p.timeline().hidden).toBe(false);
    expect(
      p.root.querySelector("[data-preaura-timeline-heading]")!.textContent,
    ).toBe("Forventet afsendelse");
    expect(p.items()).toEqual([
      "1. december 2026 – udsolgt",
      "15. januar 2027 – du køber ind i denne leverance",
      "1. marts 2027 – kommende",
    ]);
    const current = p.root.querySelector('[aria-current="true"]');
    expect(current?.textContent).toContain("15. januar 2027");
  });

  it("én leverance: ingen tidslinje (beskeden siger det samme) — stadig «forventet»", async () => {
    const p = page({
      "1": {
        current: { date: "2026-12-01", sellingPlanId: PLAN_1, remaining: 30 },
        timeline: [{ date: "2026-12-01", state: "CURRENT" }],
      },
    });
    await settle();
    expect(p.timeline().hidden).toBe(true);
    expect(p.message()).toBe("Forventet afsendelse: 1. december 2026");
  });

  it("slået fra i blokken: ingen tidslinje", async () => {
    const p = page(
      {
        "1": {
          current: { date: "2026-12-01", sellingPlanId: PLAN_1, remaining: 3 },
          timeline: [{ date: "2026-12-01", state: "CURRENT" }],
        },
      },
      { timeline: false },
    );
    await settle();
    expect(p.timeline().hidden).toBe(true);
  });
});

describe("siden følger med, når leverancen bliver udsolgt", () => {
  it("næste leverance tager over: ny dato, ny plan og nyt tal", async () => {
    const p = page({
      "1": {
        current: { date: "2027-01-15", sellingPlanId: PLAN_2, remaining: 5 },
        timeline: [],
      },
    });
    await settle();
    expect(p.message()).toBe("Forventet afsendelse: 15. januar 2027");
    expect(p.fields()).toEqual({
      selling_plan: "222",
      "properties[Forventet afsendelse]": "15. januar 2027",
    });
  });

  it("alt udsolgt imens: besked, ingen plan, og købsknappen deaktiveres — og genaktiveres", async () => {
    const p = page({
      "1": {
        current: { date: "2026-12-01", sellingPlanId: PLAN_1, remaining: 2 },
        timeline: [],
      },
    });
    await settle();
    expect(p.button().disabled).toBe(false);

    p.setResponse({ "1": { current: null, timeline: [] } });
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(p.message()).toBe("Udsolgt – alle leverancer er udsolgt.");
    expect(p.fields()).toEqual({});
    expect(p.button().disabled).toBe(true);
    expect(p.remaining().hidden).toBe(true);

    p.setResponse({
      "1": {
        current: { date: "2027-01-15", sellingPlanId: PLAN_2, remaining: 50 },
        timeline: [],
      },
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(p.button().disabled).toBe(false);
    expect(p.fields()).toMatchObject({ selling_plan: "222" });
  });
});
