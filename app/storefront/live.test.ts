import { describe, expect, it } from "vitest";
import { liveVariant, type LiveDelivery } from "./live";
import { desiredPlans, PLAN_NAME } from "../sync/plans";

const TODAY = "2026-11-06";
const d = (
  position: number,
  date: string,
  remaining: number,
  extra: Partial<LiveDelivery> = {},
): LiveDelivery => ({
  id: `d${position}`,
  position,
  date,
  status: "OPEN",
  remaining,
  sellingPlanId: `gid://shopify/SellingPlan/${position}`,
  ...extra,
});

describe("resttal i den aktuelle leverance", () => {
  it("er antallet i leverancen, kunden køber ind i — ikke summen af alle", () => {
    const live = liveVariant(
      [d(1, "2026-12-01", 0), d(2, "2027-01-15", 12), d(3, "2027-03-01", 80)],
      12,
      TODAY,
    );
    expect(live.current).toEqual({
      date: "2027-01-15",
      sellingPlanId: "gid://shopify/SellingPlan/2",
      remaining: 12,
    });
  });

  it("viser aldrig mere end Shopifys lager (købt, men endnu ikke behandlet)", () => {
    const live = liveVariant([d(1, "2026-12-01", 12)], 9, TODAY);
    expect(live.current?.remaining).toBe(9);
  });

  it("kan Shopifys lager ikke læses, vises intet tal — kun leverancen", () => {
    const live = liveVariant([d(1, "2026-12-01", 12)], null, TODAY);
    expect(live.current).toMatchObject({ date: "2026-12-01", remaining: null });
  });

  it("melder Shopify 0, er der intet at købe lige nu", () => {
    const live = liveVariant(
      [d(1, "2026-12-01", 3), d(2, "2027-01-15", 50)],
      0,
      TODAY,
    );
    expect(live.current).toBeNull();
    expect(live.timeline.map((t) => t.state)).toEqual(["SOLD_OUT", "UPCOMING"]);
  });
});

describe("tidslinje", () => {
  it("viser datoer og tilstand — udsolgt, aktuel og kommende — uden antal", () => {
    const live = liveVariant(
      [
        d(1, "2026-12-01", 0),
        d(2, "2027-01-15", 12),
        d(3, "2027-03-01", 80),
        d(4, "2027-04-01", 10, { status: "CANCELLED" }),
      ],
      12,
      TODAY,
    );
    expect(live.timeline).toEqual([
      { date: "2026-12-01", state: "SOLD_OUT" },
      { date: "2027-01-15", state: "CURRENT" },
      { date: "2027-03-01", state: "UPCOMING" },
    ]);
    expect(JSON.stringify(live.timeline)).not.toMatch(/80|remaining|quantity/);
  });

  it("udsolgte leverancer, hvis dato er passeret, vises ikke", () => {
    const live = liveVariant(
      [d(1, "2026-10-01", 0), d(2, "2026-12-01", 5)],
      5,
      TODAY,
    );
    expect(live.timeline).toEqual([{ date: "2026-12-01", state: "CURRENT" }]);
  });

  it("alt udsolgt: ingen aktuel leverance", () => {
    const live = liveVariant([d(1, "2026-12-01", 0)], 0, TODAY);
    expect(live.current).toBeNull();
    expect(live.timeline).toEqual([{ date: "2026-12-01", state: "SOLD_OUT" }]);
  });
});

describe("dobbelt dato i kurven", () => {
  it("planens navn har ingen dato — datoen står kun i linjeegenskaben", () => {
    const plans = desiredPlans(
      [
        { id: "a", position: 1, date: "2026-12-01", status: "OPEN" },
        { id: "b", position: 2, date: "2026-12-01", status: "OPEN" },
      ],
      {
        dateMode: "SHIPPING",
        shippingDateText: "Forventet afsendelse: {dato}",
        deliveryDateText: "Forventet levering: {dato}",
      },
    );
    expect(plans.map((p) => p.name)).toEqual([PLAN_NAME, PLAN_NAME]);
    expect(PLAN_NAME).not.toMatch(/\d/);
    // Valgmuligheden skal stadig kunne skelnes i gruppen.
    expect(plans.map((p) => p.option)).toEqual([
      "Forventet afsendelse: 1. december 2026",
      "Forventet afsendelse: 1. december 2026 (leverance 2)",
    ]);
  });
});
