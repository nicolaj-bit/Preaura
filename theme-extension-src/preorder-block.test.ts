// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tester app-blokkens JavaScript i en rigtig DOM med den samme fil, som
// Shopify serverer til butikken. Temaets formular er en forenklet udgave af
// den, temaer som Dawn og Horizon har.

const SCRIPT = readFileSync(
  join(
    __dirname,
    "../extensions/preaura-preorder/assets/preaura-preorder.js",
  ) /* den komprimerede fil, Shopify serverer */,
  "utf8",
);

const PLAN_1 = "gid://shopify/SellingPlan/111";

type Variants = Record<string, unknown>;

const defaults = {
  shippingLabel: "Forventet afsendelse",
  deliveryLabel: "Forventet levering",
  message: "{label}: {dato}",
  soldOutMessage: "Udsolgt – alle leverancer er udsolgt.",
  changeButtonText: false,
  buttonText: "Forudbestil",
};

function page(
  variants: Variants,
  {
    selected = "1",
    settings = {},
    locale = "da",
    themeSellingPlan = false,
    installmentForm = false,
  } = {},
) {
  document.body.innerHTML = `
    <div class="shopify-section">
      ${
        installmentForm
          ? `<form action="/cart/add" method="post" data-installment>
               <input type="hidden" name="id" value="${selected}">
             </form>`
          : ""
      }
      <form action="/cart/add" method="post" data-theme-form>
        <input type="hidden" name="id" value="${selected}">
        ${themeSellingPlan ? '<input type="radio" name="selling_plan" value="" checked>' : ""}
        <button type="submit" name="add"><span>Læg i kurv</span></button>
      </form>
      <div data-preaura-root hidden>
        <p data-preaura-message></p>
        <p data-preaura-note>Du betaler nu.</p>
        <script type="application/json" data-preaura-data>${JSON.stringify({
          selected: Number(selected),
          locale,
          settings: { ...defaults, ...settings },
          variants,
        })}</script>
      </div>
    </div>`;
  // Kør scriptet, som Shopify ville indlæse det.
  new Function(SCRIPT)();
  const form = document.querySelector(
    "form[data-theme-form]",
  ) as HTMLFormElement;
  const root = document.querySelector("[data-preaura-root]") as HTMLElement;
  return {
    form,
    root,
    message: () => root.querySelector("[data-preaura-message]")!.textContent,
    fields: () =>
      Object.fromEntries(
        [...form.querySelectorAll("[data-preaura-field]")].map((el) => [
          (el as HTMLInputElement).name,
          (el as HTMLInputElement).value,
        ]),
      ),
    button: () => form.querySelector("button span")!.textContent,
    setVariant(id: string) {
      (form.querySelector('[name="id"]') as HTMLInputElement).value = id;
    },
  };
}

const active = (date: string, plan = PLAN_1, mode = "SHIPPING") => ({
  active: true,
  mode,
  date,
  sellingPlanId: plan,
  remaining: 5,
  soldOut: false,
});

beforeEach(() => {
  vi.useFakeTimers();
});
const realFetch = window.fetch;
afterEach(() => {
  vi.useRealTimers();
  delete (window as { PreauraPreorder?: unknown }).PreauraPreorder;
  delete (window as { __preauraCartPatched?: unknown }).__preauraCartPatched;
  window.fetch = realFetch;
});

describe("app-blokken på produktsiden", () => {
  it("lægger selling_plan og en synlig linjeegenskab med datoen i formularen", () => {
    const p = page({ "1": active("2026-12-01") });
    expect(p.fields()).toEqual({
      selling_plan: "111",
      "properties[Forventet afsendelse]": "1. december 2026",
    });
    expect(p.root.hidden).toBe(false);
    expect(p.message()).toBe("Forventet afsendelse: 1. december 2026");
  });

  it("linjeegenskabens navn starter ikke med understreg (ellers skjuler Shopify den)", () => {
    const p = page({ "1": active("2026-12-01") });
    const names = Object.keys(p.fields());
    expect(names.every((n) => !n.startsWith("properties[_"))).toBe(true);
  });

  it("følger butikkens visning: forventet levering", () => {
    const p = page({ "1": active("2026-12-01", PLAN_1, "DELIVERY") });
    expect(p.fields()["properties[Forventet levering]"]).toBe(
      "1. december 2026",
    );
    expect(p.message()).toBe("Forventet levering: 1. december 2026");
  });

  it("datoformatet følger butikkens sprog", () => {
    const p = page({ "1": active("2026-12-01") }, { locale: "en" });
    expect(p.fields()["properties[Forventet afsendelse]"]).toBe(
      "December 1, 2026",
    );
  });

  it("opdaterer ved variantskifte via temaets hændelse", () => {
    const p = page({
      "1": active("2026-12-01"),
      "2": active("2027-02-01", "gid://shopify/SellingPlan/222"),
    });
    p.setVariant("2");
    document.dispatchEvent(new CustomEvent("variant:change"));
    vi.advanceTimersByTime(1);
    expect(p.fields()).toEqual({
      selling_plan: "222",
      "properties[Forventet afsendelse]": "1. februar 2027",
    });
  });

  it("reserven: opdaterer, når id-feltet ændres uden nogen hændelse (gamle temaer)", () => {
    const p = page({
      "1": active("2026-12-01"),
      "2": active("2027-02-01", "gid://shopify/SellingPlan/222"),
    });
    p.setVariant("2"); // ingen hændelse
    vi.advanceTimersByTime(300);
    expect(p.fields().selling_plan).toBe("222");
  });

  it("fjerner felterne for en variant uden forudbestilling", () => {
    const p = page({ "1": active("2026-12-01"), "2": { active: false } });
    p.setVariant("2");
    vi.advanceTimersByTime(300);
    expect(p.fields()).toEqual({});
    expect(p.root.hidden).toBe(true);
  });

  it("varianter uden metafelt (null) behandles som ikke på forudbestilling", () => {
    const p = page({ "1": null });
    expect(p.fields()).toEqual({});
    expect(p.root.hidden).toBe(true);
  });

  it("alt udsolgt: tydelig besked og hverken plan eller linjeegenskab", () => {
    const p = page({
      "1": {
        active: true,
        mode: "SHIPPING",
        date: null,
        sellingPlanId: null,
        remaining: 0,
        soldOut: true,
      },
    });
    expect(p.fields()).toEqual({});
    expect(p.root.hidden).toBe(false);
    expect(p.message()).toBe("Udsolgt – alle leverancer er udsolgt.");
  });

  it("vinder over temaets eget «Engangskøb», når formularen sendes", () => {
    const p = page({ "1": active("2026-12-01") }, { themeSellingPlan: true });
    const data = new FormData(p.form);
    // Uanset om jsdom udsender formdata-hændelsen, skal den sidste
    // selling_plan-værdi være planens — feltet ligger til sidst.
    expect(data.getAll("selling_plan").at(-1)).toBe("111");
  });

  it("formdata-hændelsen sætter planen, også hvis temaet har sit eget felt", () => {
    const p = page({ "1": active("2026-12-01") }, { themeSellingPlan: true });
    const formData = new FormData();
    formData.append("selling_plan", "");
    const event = new Event("formdata") as Event & { formData: FormData };
    Object.defineProperty(event, "formData", { value: formData });
    p.form.dispatchEvent(event);
    expect(formData.getAll("selling_plan")).toEqual(["111"]);
    expect(formData.get("properties[Forventet afsendelse]")).toBe(
      "1. december 2026",
    );
  });

  it("rører ikke købsknappen som standard", () => {
    const p = page({ "1": active("2026-12-01") });
    expect(p.button()).toBe("Læg i kurv");
  });

  it("skifter knappens tekst, når indstillingen er slået til — og sætter den tilbage", () => {
    const p = page(
      { "1": active("2026-12-01"), "2": { active: false } },
      { settings: { changeButtonText: true } },
    );
    expect(p.button()).toBe("Forudbestil");
    p.setVariant("2");
    vi.advanceTimersByTime(300);
    expect(p.button()).toBe("Læg i kurv");
  });

  it("lægger felterne ind igen, hvis temaet genskaber formularens indhold", () => {
    const p = page({ "1": active("2026-12-01") });
    p.form
      .querySelectorAll("[data-preaura-field]")
      .forEach((el) => el.remove());
    vi.advanceTimersByTime(300);
    expect(p.fields().selling_plan).toBe("111");
  });

  it("sætter ingen skrifttype, størrelse eller farve på sine elementer", () => {
    const p = page({ "1": active("2026-12-01") });
    const own = [
      p.root,
      ...p.root.querySelectorAll("*"),
      ...p.form.querySelectorAll("[data-preaura-field]"),
    ];
    expect(own.every((el) => !el.getAttribute("style"))).toBe(true);
  });

  it("tilføjer intet andet end de to skjulte felter i temaets formular", () => {
    const p = page({ "1": active("2026-12-01") });
    const added = [...p.form.children].filter((el) =>
      el.hasAttribute("data-preaura-field"),
    );
    expect(added).toHaveLength(2);
    expect(
      added.every((el) => (el as HTMLInputElement).type === "hidden"),
    ).toBe(true);
    expect(p.form.children).toHaveLength(2 + 2); // id-felt + knap + vores to
  });

  it("vælger købsformularen, ikke temaets formular til delbetaling", () => {
    const p = page({ "1": active("2026-12-01") }, { installmentForm: true });
    expect(p.fields().selling_plan).toBe("111");
    const installment = document.querySelector("form[data-installment]")!;
    expect(installment.querySelectorAll("[data-preaura-field]")).toHaveLength(
      0,
    );
  });
});

describe("temaets egne anmodninger til kurven", () => {
  // Temaer, der bygger deres egen anmodning i stedet for at sende formularen.
  // Testen installerer en falsk fetch FØR scriptet, ligesom browserens.
  function withFetch(variants: Variants) {
    const calls: { url: string; body: unknown }[] = [];
    window.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body });
      return new Response("{}");
    }) as typeof fetch;
    page(variants);
    return calls;
  }

  it("lægger plan og dato på temaets FormData, når temaet sender tom plan", async () => {
    const calls = withFetch({ "1": active("2026-12-01") });
    const body = new FormData();
    body.set("id", "1");
    body.set("quantity", "1");
    body.set("selling_plan", ""); // temaets «Engangskøb»
    await fetch("/cart/add.js", { method: "POST", body });
    const sent = calls[0].body as FormData;
    expect(sent.get("selling_plan")).toBe("111");
    expect(sent.get("properties[Forventet afsendelse]")).toBe(
      "1. december 2026",
    );
  });

  it("erstatter et tomt selling_plan, som temaet tilføjer EFTER formularens", async () => {
    // Præcis det, testbutikkens tema gjorde: FormData fra formularen (med
    // blokkens plan) og derefter et ekstra, tomt selling_plan til sidst.
    const calls = withFetch({ "1": active("2026-12-01") });
    const body = new FormData();
    body.append("id", "1");
    body.append("selling_plan", "111");
    body.append("properties[Forventet afsendelse]", "1. december 2026");
    body.append("sections", "cart-drawer");
    body.append("selling_plan", "");
    await fetch("/cart/add", { method: "POST", body });
    const sent = calls[0].body as FormData;
    expect(sent.getAll("selling_plan")).toEqual(["111"]);
    expect(sent.getAll("properties[Forventet afsendelse]")).toEqual([
      "1. december 2026",
    ]);
  });

  it("lægger plan og dato på en JSON-anmodning med items", async () => {
    const calls = withFetch({ "1": active("2026-12-01") });
    await fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: 1, quantity: 2 }] }),
    });
    expect(JSON.parse(calls[0].body as string)).toEqual({
      items: [
        {
          id: 1,
          quantity: 2,
          selling_plan: "111",
          properties: { "Forventet afsendelse": "1. december 2026" },
        },
      ],
    });
  });

  it("virker også på en urlencoded anmodning", async () => {
    const calls = withFetch({ "1": active("2026-12-01") });
    await fetch("/cart/add", { method: "POST", body: "id=1&quantity=1" });
    const sent = new URLSearchParams(calls[0].body as string);
    expect(sent.get("selling_plan")).toBe("111");
  });

  it("rører ikke varianter uden forudbestilling eller udsolgte varianter", async () => {
    const calls = withFetch({
      "1": active("2026-12-01"),
      "2": { active: false },
      "3": {
        active: true,
        mode: "SHIPPING",
        date: null,
        sellingPlanId: null,
        remaining: 0,
        soldOut: true,
      },
    });
    const body = JSON.stringify({
      items: [
        { id: 2, quantity: 1 },
        { id: 3, quantity: 1 },
      ],
    });
    await fetch("/cart/add.js", { method: "POST", body });
    expect(calls[0].body).toBe(body);
  });

  it("rører ikke andre anmodninger end /cart/add", async () => {
    const calls = withFetch({ "1": active("2026-12-01") });
    const body = JSON.stringify({ id: 1, quantity: 3 });
    await fetch("/cart/change.js", { method: "POST", body });
    expect(calls[0].body).toBe(body);
  });

  it("beholder en plan, temaet allerede har sat", async () => {
    const calls = withFetch({ "1": active("2026-12-01") });
    await fetch("/cart/add.js", {
      method: "POST",
      body: JSON.stringify({ id: 1, quantity: 1, selling_plan: 999 }),
    });
    expect(JSON.parse(calls[0].body as string).selling_plan).toBe(999);
  });

  it("virker på ældre temaer, der bruger XMLHttpRequest", () => {
    const sent: unknown[] = [];
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      sent.push(body);
    };
    try {
      page({ "1": active("2026-12-01") });
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/cart/add.js");
      xhr.send("id=1&quantity=1");
      expect(new URLSearchParams(sent[0] as string).get("selling_plan")).toBe(
        "111",
      );
    } finally {
      XMLHttpRequest.prototype.send = originalSend;
    }
  });
});

describe("extensionens filstruktur", () => {
  it("indeholder kun det, Shopify tillader i en theme app extension", () => {
    // Shopify afviser extensionen ved alt andet end disse (fundet i testbutikken).
    const dir = join(__dirname, "../extensions/preaura-preorder");
    const allowed = [
      "assets",
      "blocks",
      "locales",
      "shopify.extension.toml",
      "snippets",
      "package.json",
    ];
    expect(readdirSync(dir).filter((name) => !allowed.includes(name))).toEqual(
      [],
    );
    // Git gemmer ikke tomme mapper: locales skal indeholde en fil.
    expect(readdirSync(join(dir, "locales")).length).toBeGreaterThan(0);
  });
});
