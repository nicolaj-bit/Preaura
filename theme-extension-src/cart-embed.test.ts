// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GROUP_OPTION,
  PLAN_LANGUAGES,
  PLAN_NAME,
  planName,
  type PlanLanguage,
} from "../app/sync/plans";

// Tester kurvens app embed i en rigtig DOM med den samme fil, som Shopify
// serverer. Kurvene er forenklede udgaver af Dawns og Horizons.

const SCRIPT = readFileSync(
  join(__dirname, "../extensions/preaura-preorder/assets/preaura-cart.js"),
  "utf8",
);

const config = {
  lineNote: "Intet at betale i dag. Beløbet trækkes, når varen sendes.",
  showTotals: true,
  laterLabel: "Trækkes ved afsendelse",
  todayLabel: "Betales i dag",
  moneyFormat: "{{amount_with_comma_separator}} kr",
  currency: "DKK",
  count: 2,
};

// Som Shopifys /cart.js faktisk svarer (set i testbutikken): ingen beløb for
// i dag og senere — planen genkendes på navn og valg, som appen opretter dem.
const preorderLine = (price: number, quantity = 1) => ({
  quantity,
  final_line_price: price * quantity,
  selling_plan_allocation: {
    price_adjustments: [],
    price,
    compare_at_price: null,
    per_delivery_price: price,
    selling_plan: {
      id: 724582400331,
      name: PLAN_NAME as string,
      description: null,
      options: [
        {
          name: GROUP_OPTION as string,
          position: 1,
          value: "Forventet afsendelse: 2. december 2026",
        },
      ],
      recurring_deliveries: false,
      fixed_selling_plan: true,
      price_adjustments: [],
    },
  },
});
const normalLine = (price: number) => ({
  quantity: 1,
  final_line_price: price,
  selling_plan_allocation: null,
});

function cartJson(items: unknown[]) {
  const total = (items as { final_line_price: number }[]).reduce(
    (sum, i) => sum + i.final_line_price,
    0,
  );
  return { items, total_price: total, currency: "DKK" };
}

let realFetch: typeof window.fetch;

async function page(html: string, cart: unknown, settings = {}) {
  realFetch = window.fetch;
  let current = cart;
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith("cart.js")) {
      return new Response(JSON.stringify(current), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  window.fetch = fetchMock as unknown as typeof window.fetch;
  delete (window as unknown as Record<string, unknown>).__preauraCart;
  document.body.innerHTML = `${html}
    <script type="application/json" data-preaura-cart-config>${JSON.stringify({
      ...config,
      ...settings,
    })}</script>`;
  new Function(SCRIPT)();
  await settle();
  return {
    fetchMock,
    setCart: (next: unknown) => {
      current = next;
    },
    notes: () =>
      [...document.querySelectorAll("[data-preaura-cart=note]")].map(
        (n) => n.textContent,
      ),
    totals: () =>
      [...document.querySelectorAll("[data-preaura-cart=totals] > div")].map(
        (d) => [...d.children].map((c) => c.textContent).join(": "),
      ),
  };
}

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 120));
}

afterEach(() => {
  (
    window as unknown as { PreauraCart?: { stop: () => void } }
  ).PreauraCart?.stop();
  if (realFetch) window.fetch = realFetch;
  document.body.innerHTML = "";
});

const dawnDrawer = `
  <cart-drawer>
    <div class="cart-item">
      <a class="cart-item__name">test preaura</a>
      <dl><div class="product-option"><dd>Forventet afsendelse: 2. december 2026</dd></div></dl>
      <p class="product-option">Forudbestilling</p>
    </div>
    <div class="cart-item">
      <a class="cart-item__name">Almindelig vare</a>
    </div>
    <div class="cart__ctas" style="display:flex">
      <button type="submit" name="checkout" class="cart__checkout-button">Til kassen</button>
    </div>
  </cart-drawer>`;

describe("kurvens app embed", () => {
  it("viser noten under den forudbestilte vare og beløbene over knappen", async () => {
    const p = await page(
      dawnDrawer,
      cartJson([preorderLine(159900), normalLine(29900)]),
    );
    expect(p.notes()).toEqual([config.lineNote]);
    const note = document.querySelector("[data-preaura-cart=note]")!;
    // Samme klasse som temaets egen linje, lige efter planens navn.
    expect(note.previousElementSibling!.textContent).toBe("Forudbestilling");
    expect(note.classList.contains("product-option")).toBe(true);
    expect(p.totals()).toEqual([
      "Trækkes ved afsendelse: 1.599,00 kr",
      "Betales i dag: 299,00 kr",
    ]);
    // Over hele den vandrette række, ikke ved siden af knappen.
    const totals = document.querySelector("[data-preaura-cart=totals]")!;
    expect(totals.nextElementSibling!.className).toBe("cart__ctas");
  });

  it("viser intet, når der ikke er en forudbestilling i kurven", async () => {
    const p = await page(dawnDrawer, cartJson([normalLine(29900)]));
    expect(p.notes()).toEqual([]);
    expect(p.totals()).toEqual([]);
  });

  it("henter ikke kurven, når den er tom ved sideindlæsning", async () => {
    const p = await page(dawnDrawer, cartJson([]), { count: 0 });
    expect(p.fetchMock).not.toHaveBeenCalled();
  });

  it("opdaterer beløbene, når kurven ændres, og sætter elementerne ind igen, når temaet bygger kurven om", async () => {
    const p = await page(dawnDrawer, cartJson([preorderLine(45000)]));
    expect(p.totals()).toEqual([
      "Trækkes ved afsendelse: 450,00 kr",
      "Betales i dag: 0,00 kr",
    ]);

    // Kunden sætter antal op: temaet kalder /cart/change og bygger skuffen om.
    p.setCart(cartJson([preorderLine(45000, 2)]));
    await window.fetch("/cart/change.js", { method: "POST", body: "{}" });
    document.querySelector("cart-drawer")!.outerHTML = dawnDrawer;
    await settle();
    expect(p.notes()).toEqual([config.lineNote]);
    expect(p.totals()).toEqual([
      "Trækkes ved afsendelse: 900,00 kr",
      "Betales i dag: 0,00 kr",
    ]);

    // Forudbestillingen fjernes: alt vores forsvinder.
    p.setCart(cartJson([normalLine(29900)]));
    await window.fetch("/cart/change.js", { method: "POST", body: "{}" });
    await settle();
    expect(p.notes()).toEqual([]);
    expect(p.totals()).toEqual([]);
  });

  it("rører ikke produktsidens formular, selv om planens navn står der", async () => {
    const p = await page(
      `<form action="/cart/add" class="product-form"><label>Forudbestilling</label></form>${dawnDrawer}`,
      cartJson([preorderLine(45000)]),
    );
    expect(p.notes()).toHaveLength(1);
    expect(
      document.querySelector("form[action='/cart/add'] [data-preaura-cart]"),
    ).toBeNull();
  });

  it("kan slå beløbene fra og bruge sine egne tekster", async () => {
    const p = await page(dawnDrawer, cartJson([preorderLine(45000)]), {
      showTotals: false,
      lineNote: "Nothing due today.",
    });
    expect(p.notes()).toEqual(["Nothing due today."]);
    expect(p.totals()).toEqual([]);
  });
});

describe("hvilke planer tæller med", () => {
  const summarize = () =>
    (
      window as unknown as {
        PreauraCart: {
          summarize: (c: unknown) => { later: number; today: number } | null;
        };
      }
    ).PreauraCart.summarize;

  it("genkender planerne på alle sprog, appen opretter dem på", async () => {
    await page("", cartJson([]), { count: 0 });
    for (const [language, t] of Object.entries(PLAN_LANGUAGES)) {
      // Også de nummererede: «Forudbestilling (leverance 2)».
      for (const position of [1, 2, 12]) {
        const name = planName(language as PlanLanguage, position);
        const line = preorderLine(45000);
        line.selling_plan_allocation.selling_plan.name = name;
        line.selling_plan_allocation.selling_plan.options[0].name =
          t.groupOption;
        expect(summarize()(cartJson([line])), name).toMatchObject({
          later: 45000,
          today: 0,
        });
      }
    }
  });

  it("andre apps' planer tæller ikke med (fx abonnement)", async () => {
    await page("", cartJson([]), { count: 0 });
    const other = {
      quantity: 1,
      final_line_price: 10000,
      selling_plan_allocation: {
        selling_plan: {
          name: "Hver måned",
          options: [{ name: "Levering", value: "1 måned" }],
          fixed_selling_plan: false,
        },
      },
    };
    expect(summarize()(cartJson([other]))).toBeNull();
  });

  it("oplyser Shopify selv fordelingen, bruges den — også for andre planer", async () => {
    await page("", cartJson([]), { count: 0 });
    const deposit = {
      quantity: 1,
      final_line_price: 10000,
      selling_plan_allocation: {
        checkout_charge_amount: 2500,
        remaining_balance_charge_amount: 7500,
        selling_plan: { name: "Depositum", options: [] },
      },
    };
    expect(summarize()(cartJson([deposit]))).toMatchObject({
      later: 7500,
      today: 2500,
    });
  });
});

describe("beløb i butikkens format", () => {
  it("følger butikkens money-format", async () => {
    await page("", cartJson([]), { count: 0 });
    const { money } = (
      window as unknown as {
        PreauraCart: { money: (c: number, cur?: string) => string };
      }
    ).PreauraCart;
    expect(money(159900)).toBe("1.599,00 kr");
    expect(money(123456789)).toBe("1.234.567,89 kr");
  });

  it("fordeler en rabat efter planen og trækker kun resten fra i dag", async () => {
    await page("", cartJson([]), { count: 0 });
    const { summarize } = (
      window as unknown as {
        PreauraCart: {
          summarize: (c: unknown) => { later: number; today: number } | null;
        };
      }
    ).PreauraCart;
    const line = { ...preorderLine(45000), final_line_price: 40000 };
    expect(
      summarize({ items: [line, normalLine(10000)], total_price: 50000 }),
    ).toMatchObject({ later: 40000, today: 10000 });
  });
});
