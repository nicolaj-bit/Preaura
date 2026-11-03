// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tester app-blokkens JavaScript i en rigtig DOM med den samme fil, som
// Shopify serverer til butikken. Temaets formular er en forenklet udgave af
// den, temaer som Dawn og Horizon har.

const SCRIPT = readFileSync(
  join(__dirname, "assets/preaura-preorder.js"),
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
afterEach(() => {
  vi.useRealTimers();
  delete (window as { PreauraPreorder?: unknown }).PreauraPreorder;
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
