import { describe, expect, it } from "vitest";
import { dashboardStats, progressPct } from "./dashboard";

const now = new Date("2026-11-30T12:00:00Z");
const daysAgo = (n: number) =>
  new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

describe("nøgletal på forsiden", () => {
  it("tæller ordrer (ikke linjer) og stk. de seneste 30 dage", () => {
    const stats = dashboardStats(
      [
        { orderId: "1", quantity: 2, orderCreatedAt: daysAgo(1) },
        { orderId: "1", quantity: 1, orderCreatedAt: daysAgo(1) }, // samme ordre
        { orderId: "2", quantity: 1, orderCreatedAt: daysAgo(29) },
        { orderId: "3", quantity: 5, orderCreatedAt: daysAgo(31) }, // forrige periode
        { orderId: "4", quantity: 5, orderCreatedAt: null },
      ],
      now,
    );
    expect(stats).toEqual({ orders30: 2, ordersTrendPct: 100, units30: 4 });
  });

  it("ingen udvikling, når der intet er at sammenligne med", () => {
    expect(
      dashboardStats(
        [{ orderId: "1", quantity: 1, orderCreatedAt: daysAgo(2) }],
        now,
      ).ordersTrendPct,
    ).toBeNull();
  });

  it("fald vises som negativ procent", () => {
    const stats = dashboardStats(
      [
        { orderId: "1", quantity: 1, orderCreatedAt: daysAgo(2) },
        { orderId: "2", quantity: 1, orderCreatedAt: daysAgo(40) },
        { orderId: "3", quantity: 1, orderCreatedAt: daysAgo(45) },
      ],
      now,
    );
    expect(stats.ordersTrendPct).toBe(-50);
  });

  it("fremdriftslinjen holder sig mellem 0 og 100", () => {
    expect(progressPct(4, 7)).toBe(57);
    expect(progressPct(12, 10)).toBe(100);
    expect(progressPct(0, 0)).toBe(0);
  });
});
