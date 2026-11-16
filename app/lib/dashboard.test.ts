import { describe, expect, it } from "vitest";
import { dashboardStats, parsePeriod, progressPct } from "./dashboard";

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
    expect(stats).toMatchObject({
      orders: 2,
      ordersTrendPct: 100,
      units: 4,
      amount: null,
      averageOrder: null,
    });
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

  it("perioden kan være 7 dage", () => {
    const stats = dashboardStats(
      [
        { orderId: "1", quantity: 1, orderCreatedAt: daysAgo(3) },
        { orderId: "2", quantity: 1, orderCreatedAt: daysAgo(10) },
      ],
      now,
      7,
    );
    expect(stats.orders).toBe(1);
    expect(stats.ordersTrendPct).toBe(0);
  });

  it("lægger beløb sammen pr. stk. og regner gennemsnit pr. ordre", () => {
    const price = (unitPrice: string) => ({ unitPrice, currency: "DKK" });
    const stats = dashboardStats(
      [
        { orderId: "1", quantity: 2, orderCreatedAt: daysAgo(1), ...price("100.50") },
        { orderId: "1", quantity: 1, orderCreatedAt: daysAgo(1), ...price("50") },
        { orderId: "2", quantity: 1, orderCreatedAt: daysAgo(5), ...price("49.25") },
        { orderId: "3", quantity: 1, orderCreatedAt: daysAgo(40), ...price("150") },
      ],
      now,
    );
    expect(stats.amount).toEqual({ value: 300.25, currency: "DKK" });
    expect(stats.averageOrder).toEqual({ value: 150.13, currency: "DKK" });
    expect(stats.amountTrendPct).toBe(100);
    expect(stats.amountPartial).toBe(false);
  });

  it("markerer, når nogle ordrer er fra før prisen blev gemt", () => {
    const stats = dashboardStats(
      [
        { orderId: "1", quantity: 1, orderCreatedAt: daysAgo(1), unitPrice: "10", currency: "DKK" },
        { orderId: "2", quantity: 1, orderCreatedAt: daysAgo(2) },
      ],
      now,
    );
    expect(stats.amount?.value).toBe(10);
    expect(stats.averageOrder?.value).toBe(10);
    expect(stats.amountPartial).toBe(true);
  });

  it("blander ikke valutaer: kun den senest brugte tælles", () => {
    const stats = dashboardStats(
      [
        { orderId: "1", quantity: 1, orderCreatedAt: daysAgo(1), unitPrice: "10", currency: "EUR" },
        { orderId: "2", quantity: 1, orderCreatedAt: daysAgo(9), unitPrice: "75", currency: "DKK" },
      ],
      now,
    );
    expect(stats.amount).toEqual({ value: 10, currency: "EUR" });
  });

  it("ukendt periode falder tilbage til 30 dage", () => {
    expect(parsePeriod("7")).toBe(7);
    expect(parsePeriod("90")).toBe(90);
    expect(parsePeriod("365")).toBe(30);
    expect(parsePeriod(null)).toBe(30);
  });

  it("fremdriftslinjen holder sig mellem 0 og 100", () => {
    expect(progressPct(4, 7)).toBe(57);
    expect(progressPct(12, 10)).toBe(100);
    expect(progressPct(0, 0)).toBe(0);
  });
});
