// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Ventelisten i app-blokken: feltet vises kun, når varianten hverken kan
// købes på lager eller forudbestilles, og tilmeldingen sendes til appen
// gennem app-proxyen.

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
const LIQUID = readFileSync(
  join(__dirname, "../extensions/preaura-preorder/blocks/preorder.liquid"),
  "utf8",
);

const settings = {
  shippingLabel: "Forventet afsendelse",
  deliveryLabel: "Forventet levering",
  message: "{label}: {dato}",
  soldOutMessage: "Udsolgt",
  changeButtonText: false,
  buttonText: "Forudbestil",
  waitlist: true,
  waitlistSuccess: "Tak. Vi giver dig besked.",
  waitlistError: "Det lykkedes ikke.",
  waitlistInvalid: "Skriv en gyldig e-mail.",
};

function page({
  selected = "1",
  variants = {} as Record<string, unknown>,
  available = {} as Record<string, boolean>,
  waitlist = true,
} = {}) {
  document.body.innerHTML = `
    <div class="shopify-section">
      <form action="/cart/add" method="post" data-theme-form>
        <input type="hidden" name="id" value="${selected}">
        <button type="submit" name="add"><span>Læg i kurv</span></button>
      </form>
      <div data-preaura-root hidden>
        <p data-preaura-message></p>
        <div data-preaura-waitlist hidden>
          <label for="e">E-mail</label>
          <input id="e" type="email" name="email" required data-preaura-waitlist-email>
          <input type="text" name="website" hidden data-preaura-waitlist-trap>
          <button type="button" data-preaura-waitlist-submit>Giv mig besked</button>
          <p data-preaura-waitlist-status></p>
        </div>
        <script type="application/json" data-preaura-data>${JSON.stringify({
          selected: Number(selected),
          locale: "da",
          settings: { ...settings, waitlist },
          variants,
          available,
        })}</script>
      </div>
    </div>`;
  new Function(SCRIPT)();
  new Function(EXTRAS)();
  const root = document.querySelector("[data-preaura-root]") as HTMLElement;
  const box = root.querySelector("[data-preaura-waitlist]") as HTMLElement;
  return {
    root,
    box,
    email: box.querySelector("input[type=email]") as HTMLInputElement,
    submit: box.querySelector("button") as HTMLButtonElement,
    status: () =>
      box.querySelector("[data-preaura-waitlist-status]")!.textContent,
    select(id: string) {
      (document.querySelector('[name="id"]') as HTMLInputElement).value = id;
      document.dispatchEvent(new Event("variant:change"));
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { __preauraCartPatched?: boolean }).__preauraCartPatched;
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("feltet vises kun, når varen ikke kan købes", () => {
  it("udsolgt variant uden forudbestilling: feltet vises", () => {
    const p = page({ available: { "1": false } });
    expect(p.root.hidden).toBe(false);
    expect(p.box.hidden).toBe(false);
  });

  it("variant på lager: intet felt, og blokken er skjult", () => {
    const p = page({ available: { "1": true } });
    expect(p.box.hidden).toBe(true);
    expect(p.root.hidden).toBe(true);
  });

  it("kan forudbestilles: forudbestillingen vises, ikke feltet", () => {
    const p = page({
      available: { "1": true },
      variants: {
        "1": {
          active: true,
          mode: "SHIPPING",
          date: "2026-12-01",
          sellingPlanId: "gid://shopify/SellingPlan/1",
          remaining: 3,
          soldOut: false,
        },
      },
    });
    expect(p.box.hidden).toBe(true);
    expect(p.root.hidden).toBe(false);
  });

  it("alle leverancer udsolgt: udsolgt-beskeden og feltet", () => {
    const p = page({
      available: { "1": false },
      variants: {
        "1": {
          active: true,
          mode: "SHIPPING",
          date: null,
          sellingPlanId: null,
          remaining: 0,
          soldOut: true,
        },
      },
    });
    expect(p.box.hidden).toBe(false);
    expect(p.root.textContent).toContain("Udsolgt");
  });

  it("slået fra i blokken: intet felt", () => {
    const p = page({ available: { "1": false }, waitlist: false });
    expect(p.box.hidden).toBe(true);
  });

  it("følger variantskift", async () => {
    const p = page({ available: { "1": false, "2": true } });
    p.select("2");
    await tick();
    expect(p.box.hidden).toBe(true);
    p.select("1");
    await tick();
    expect(p.box.hidden).toBe(false);
  });
});

describe("tilmeldingen", () => {
  it("sendes til app-proxyen med e-mail og variant — og viser samme svar hver gang", async () => {
    const calls: { url: string; body: string }[] = [];
    window.fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = page({ available: { "1": false } });
    p.email.value = "anna@example.com";
    p.submit.click();
    await tick();
    await tick();
    expect(calls).toEqual([
      {
        url: "/apps/preaura/waitlist",
        body: "email=anna%40example.com&variant_id=1&website=",
      },
    ]);
    expect(p.status()).toBe("Tak. Vi giver dig besked.");
    expect(p.email.value).toBe("");
  });

  it("Enter i feltet tilmelder — og lægger ikke varen i kurven", async () => {
    // Scriptet pakker window.fetch ind, så vi holder fast i vores egen.
    const spy = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    window.fetch = spy as unknown as typeof fetch;
    const p = page({ available: { "1": false } });
    p.email.value = "anna@example.com";
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      cancelable: true,
    });
    p.email.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("ugyldig e-mail sendes ikke", () => {
    const spy = vi.fn();
    window.fetch = spy as unknown as typeof fetch;
    const p = page({ available: { "1": false } });
    p.email.value = "ikke-en-mail";
    p.submit.click();
    expect(spy).not.toHaveBeenCalled();
    expect(p.status()).toBe("Skriv en gyldig e-mail.");
  });

  it("fejl og begrænsning: en neutral besked", async () => {
    window.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, error: "rate_limited" }), {
          status: 429,
        }),
    ) as unknown as typeof fetch;
    const p = page({ available: { "1": false } });
    p.email.value = "anna@example.com";
    p.submit.click();
    await tick();
    await tick();
    expect(p.status()).toBe("Det lykkedes ikke.");
  });
});

describe("blokken (Liquid)", () => {
  const markup = LIQUID.split("{% schema %}")[0];
  const schema = JSON.parse(
    LIQUID.split("{% schema %}")[1].split("{% endschema %}")[0],
  ) as { settings: { id?: string; type: string; default?: unknown }[] };

  it("har ingen afkrydsningsfelter i formularen og intet krydset af på forhånd", () => {
    expect(markup).not.toMatch(/type="checkbox"|type="radio"|\bchecked\b/);
  });

  it("har ingen farver, skrifttyper eller størrelser af sin egen — kun struktur", () => {
    // Ingen style-attributter, og det eneste stylesheet er tidslinjens linje
    // og afstand i tekstens egen farve (currentColor).
    expect(markup).not.toMatch(/style="/);
    const css = [...markup.matchAll(/<style>([\s\S]*?)<\/style>/g)]
      .map((m) => m[1])
      .join("");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|hsl|font|color:|background/i);
    expect(css.match(/solid [^;}\s]+/g)).toEqual(["solid currentColor"]);
  });

  it("ventelisten er slået fra, til butikken selv slår den til", () => {
    const setting = schema.settings.find((s) => s.id === "waitlist_enabled");
    expect(setting).toMatchObject({ type: "checkbox", default: false });
  });

  it("teksten lover kun besked om varen — ikke nyhedsbrev", () => {
    const privacy = schema.settings.find((s) => s.id === "waitlist_privacy");
    expect(String(privacy?.default)).toMatch(/ikke tilmeldt.*nyhedsbrev/);
  });
});
