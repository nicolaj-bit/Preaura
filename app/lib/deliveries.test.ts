import { describe, expect, it } from "vitest";
import {
  MESSAGES,
  addDays,
  allocatedQuantity,
  deliveryState,
  findActiveDelivery,
  isValidDateString,
  remainingQuantity,
  todayInTimeZone,
  validateDelivery,
} from "./deliveries";

const active = (quantity: number) => ({ quantity, status: "ACTIVE" });
const cancelled = (quantity: number) => ({ quantity, status: "CANCELLED" });

describe("resterende antal", () => {
  it("er hele antallet, når intet er tildelt", () => {
    expect(remainingQuantity(10, [])).toBe(10);
  });

  it("trækker aktive tildelinger fra", () => {
    expect(remainingQuantity(10, [active(3), active(2)])).toBe(5);
  });

  it("tæller ikke annullerede tildelinger med", () => {
    expect(remainingQuantity(10, [active(3), cancelled(4)])).toBe(7);
  });

  it("er 0, når leverancen er fuldt tildelt", () => {
    expect(remainingQuantity(5, [active(2), active(3)])).toBe(0);
  });

  it("klippes ikke ved 0, så overbooking kan ses", () => {
    expect(remainingQuantity(5, [active(7)])).toBe(-2);
  });

  it("giver samme tal, hvis en tildeling annulleres og en ny oprettes", () => {
    const before = [active(4)];
    const after = [cancelled(4), active(4)];
    expect(remainingQuantity(10, after)).toBe(remainingQuantity(10, before));
  });

  it("allocatedQuantity summerer kun aktive", () => {
    expect(allocatedQuantity([active(1), cancelled(5), active(2)])).toBe(3);
  });
});

describe("aktiv leverance", () => {
  const d = (
    id: string,
    position: number,
    remaining: number,
    status = "OPEN",
  ) => ({
    id,
    position,
    remaining,
    status,
  });

  it("er den første efter rækkefølgenummer, der ikke er udsolgt", () => {
    const deliveries = [d("c", 3, 5), d("a", 1, 0), d("b", 2, 4)];
    expect(findActiveDelivery(deliveries)?.id).toBe("b");
  });

  it("springer annullerede leverancer over", () => {
    expect(
      findActiveDelivery([d("a", 1, 5, "CANCELLED"), d("b", 2, 5)])?.id,
    ).toBe("b");
  });

  it("springer overbookede leverancer over", () => {
    expect(findActiveDelivery([d("a", 1, -1), d("b", 2, 1)])?.id).toBe("b");
  });

  it("er null, når alt er udsolgt eller annulleret", () => {
    expect(
      findActiveDelivery([d("a", 1, 0), d("b", 2, 3, "CANCELLED")]),
    ).toBeNull();
    expect(findActiveDelivery([])).toBeNull();
  });

  it("deliveryState giver den rigtige status", () => {
    expect(deliveryState(d("a", 1, 5), "a")).toBe("ACTIVE");
    expect(deliveryState(d("b", 2, 5), "a")).toBe("UPCOMING");
    expect(deliveryState(d("c", 1, 0), "a")).toBe("SOLD_OUT");
    expect(deliveryState(d("d", 1, 5, "CANCELLED"), "a")).toBe("CANCELLED");
  });
});

describe("validering af leverance", () => {
  const today = "2026-11-02";
  const ctx = { today, allocated: 0 };

  it("godkender en gyldig leverance", () => {
    expect(
      validateDelivery({ date: "2026-12-01", quantity: "50" }, ctx),
    ).toEqual({
      ok: true,
      value: { date: "2026-12-01", quantity: 50 },
    });
  });

  describe("datoen skal være i fremtiden", () => {
    it("afviser dags dato", () => {
      const result = validateDelivery({ date: today, quantity: "1" }, ctx);
      expect(result).toEqual({
        ok: false,
        errors: { date: MESSAGES.dateNotFuture },
      });
    });

    it("afviser en dato i fortiden", () => {
      const result = validateDelivery(
        { date: "2026-11-01", quantity: "1" },
        ctx,
      );
      expect(result).toEqual({
        ok: false,
        errors: { date: MESSAGES.dateNotFuture },
      });
    });

    it("godkender i morgen", () => {
      expect(
        validateDelivery({ date: "2026-11-03", quantity: "1" }, ctx).ok,
      ).toBe(true);
    });

    it("tillader en uændret, passeret dato, når en leverance rettes", () => {
      const result = validateDelivery(
        { date: "2026-10-01", quantity: "5" },
        { ...ctx, currentDate: "2026-10-01" },
      );
      expect(result.ok).toBe(true);
    });

    it("afviser at flytte en leverance til en passeret dato", () => {
      const result = validateDelivery(
        { date: "2026-10-15", quantity: "5" },
        { ...ctx, currentDate: "2026-12-01" },
      );
      expect(result).toEqual({
        ok: false,
        errors: { date: MESSAGES.dateNotFuture },
      });
    });

    it("afviser manglende og ugyldige datoer", () => {
      expect(validateDelivery({ date: "", quantity: "1" }, ctx)).toEqual({
        ok: false,
        errors: { date: MESSAGES.dateMissing },
      });
      expect(validateDelivery({ date: null, quantity: "1" }, ctx)).toEqual({
        ok: false,
        errors: { date: MESSAGES.dateMissing },
      });
      for (const date of ["2027-02-30", "2027-13-01", "1-2-2027", "i morgen"]) {
        expect(validateDelivery({ date, quantity: "1" }, ctx)).toEqual({
          ok: false,
          errors: { date: MESSAGES.dateInvalid },
        });
      }
    });
  });

  describe("antal skal være større end nul", () => {
    it("afviser 0", () => {
      expect(
        validateDelivery({ date: "2026-12-01", quantity: "0" }, ctx),
      ).toEqual({
        ok: false,
        errors: { quantity: MESSAGES.quantityNotPositive },
      });
    });

    it("afviser negative tal", () => {
      expect(
        validateDelivery({ date: "2026-12-01", quantity: "-3" }, ctx),
      ).toEqual({
        ok: false,
        errors: { quantity: MESSAGES.quantityNotPositive },
      });
    });

    it("afviser decimaltal, tekst og tomt felt", () => {
      for (const quantity of ["1.5", "abc", "", null, 2.5]) {
        expect(validateDelivery({ date: "2026-12-01", quantity }, ctx)).toEqual(
          {
            ok: false,
            errors: { quantity: MESSAGES.quantityInvalid },
          },
        );
      }
    });

    it("godkender 1", () => {
      expect(
        validateDelivery({ date: "2026-12-01", quantity: "1" }, ctx).ok,
      ).toBe(true);
    });
  });

  describe("antal må ikke være lavere end det tildelte", () => {
    const withAllocated = { ...ctx, allocated: 12 };

    it("afviser et antal under det tildelte", () => {
      expect(
        validateDelivery({ date: "2026-12-01", quantity: "11" }, withAllocated),
      ).toEqual({
        ok: false,
        errors: { quantity: MESSAGES.quantityBelowAllocated(12) },
      });
    });

    it("godkender præcis det tildelte", () => {
      expect(
        validateDelivery({ date: "2026-12-01", quantity: "12" }, withAllocated)
          .ok,
      ).toBe(true);
    });

    it("beskeden nævner det tildelte antal", () => {
      expect(MESSAGES.quantityBelowAllocated(12)).toContain("12 stk.");
    });
  });

  it("returnerer fejl på begge felter på én gang", () => {
    expect(
      validateDelivery({ date: "2020-01-01", quantity: "0" }, ctx),
    ).toEqual({
      ok: false,
      errors: {
        date: MESSAGES.dateNotFuture,
        quantity: MESSAGES.quantityNotPositive,
      },
    });
  });
});

describe("datoer", () => {
  it("isValidDateString kender skudår", () => {
    expect(isValidDateString("2028-02-29")).toBe(true);
    expect(isValidDateString("2027-02-29")).toBe(false);
  });

  it("todayInTimeZone bruger butikkens tidszone", () => {
    // 23:30 UTC den 2. november er allerede den 3. i København.
    const now = new Date("2026-11-02T23:30:00Z");
    expect(todayInTimeZone("UTC", now)).toBe("2026-11-02");
    expect(todayInTimeZone("Europe/Copenhagen", now)).toBe("2026-11-03");
  });

  it("addDays krydser måneds- og årsskifte", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("konkrete fejlbeskeder", () => {
  const today = "2026-11-07";
  it("dato i fortiden, antal 0: siger hvad der er galt og hvad man skal gøre", () => {
    const result = validateDelivery(
      { date: "2026-11-01", quantity: "0" },
      { today, allocated: 0 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.date).toMatch(/passeret.*Vælg en dato fra i morgen/);
    expect(result.errors.quantity).toMatch(/mindst 1.*annullér leverancen/);
  });

  it("overlap: samme dato som en anden leverance", () => {
    const result = validateDelivery(
      { date: "2026-12-01", quantity: "10" },
      { today, allocated: 0, others: [{ position: 1, date: "2026-12-01" }] },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.date).toBe(
      "Leverance 1 har allerede datoen 1. december 2026. Ret antallet på leverance 1 i stedet, eller vælg en anden dato.",
    );
  });

  it("en ny leverance skal ligge efter de eksisterende", () => {
    const result = validateDelivery(
      { date: "2026-12-01", quantity: "10" },
      {
        today,
        allocated: 0,
        newDelivery: true,
        others: [
          { position: 1, date: "2026-11-20" },
          { position: 2, date: "2027-01-15" },
        ],
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.date).toMatch(
      /efter 15\. januar 2027 \(leverance 2\)/,
    );
  });

  it("en eksisterende leverance må gerne flyttes mellem de andre", () => {
    const result = validateDelivery(
      { date: "2026-12-01", quantity: "10" },
      { today, allocated: 0, others: [{ position: 2, date: "2027-01-15" }] },
    );
    expect(result.ok).toBe(true);
  });
});
