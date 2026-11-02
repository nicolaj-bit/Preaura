import { describe, expect, it } from "vitest";
import {
  planLineAllocation,
  sameAllocation,
  type DeliverySlot,
} from "./allocation";

const slot = (
  id: string,
  position: number,
  remaining: number,
  status = "OPEN",
): DeliverySlot => ({
  id,
  position,
  remaining,
  status,
  date: `2027-0${position}-01`,
});

const D1 = slot("d1", 1, 10);
const D2 = slot("d2", 2, 20);

describe("fordeling af en ordrelinje", () => {
  it("lægger en ny linje i planens leverance", () => {
    expect(
      planLineAllocation({
        desired: 3,
        current: [],
        startDeliveryId: "d1",
        deliveries: [D1, D2],
      }),
    ).toEqual([{ deliveryId: "d1", quantity: 3, promisedDate: "2027-01-01" }]);
  });

  it("fylder resten i næste leverance, når der ikke er plads", () => {
    expect(
      planLineAllocation({
        desired: 4,
        current: [],
        startDeliveryId: "d1",
        deliveries: [slot("d1", 1, 1), D2],
      }),
    ).toEqual([
      { deliveryId: "d1", quantity: 1, promisedDate: "2027-01-01" },
      { deliveryId: "d2", quantity: 3, promisedDate: "2027-02-01" },
    ]);
  });

  it("starter i planens leverance — aldrig i en tidligere", () => {
    expect(
      planLineAllocation({
        desired: 2,
        current: [],
        startDeliveryId: "d2",
        deliveries: [D1, D2],
      }),
    ).toEqual([{ deliveryId: "d2", quantity: 2, promisedDate: "2027-02-01" }]);
  });

  it("springer annullerede leverancer over", () => {
    expect(
      planLineAllocation({
        desired: 2,
        current: [],
        startDeliveryId: "d1",
        deliveries: [slot("d1", 1, 10, "CANCELLED"), D2],
      }),
    ).toEqual([{ deliveryId: "d2", quantity: 2, promisedDate: "2027-02-01" }]);
  });

  it("gør resten uafklaret, når der ikke er plads nogen steder", () => {
    expect(
      planLineAllocation({
        desired: 5,
        current: [],
        startDeliveryId: "d1",
        deliveries: [slot("d1", 1, 2), slot("d2", 2, 0)],
      }),
    ).toEqual([
      { deliveryId: "d1", quantity: 2, promisedDate: "2027-01-01" },
      { deliveryId: null, quantity: 3, promisedDate: null },
    ]);
  });

  it("ændrer intet, når antallet er det samme", () => {
    const current = [
      { deliveryId: "d1", quantity: 3, promisedDate: "2026-12-24" },
    ];
    const result = planLineAllocation({
      desired: 3,
      current,
      startDeliveryId: "d1",
      deliveries: [D1, D2],
    });
    expect(sameAllocation(result, current)).toBe(true);
    // Den lovede dato bevares, selvom leverancens dato er en anden nu.
    expect(result[0].promisedDate).toBe("2026-12-24");
  });

  it("et større antal lægges oveni og bevarer det eksisterende", () => {
    expect(
      planLineAllocation({
        desired: 5,
        current: [
          { deliveryId: "d1", quantity: 2, promisedDate: "2026-12-24" },
        ],
        startDeliveryId: "d1",
        deliveries: [slot("d1", 1, 1), D2],
      }),
    ).toEqual([
      { deliveryId: "d1", quantity: 3, promisedDate: "2026-12-24" },
      { deliveryId: "d2", quantity: 2, promisedDate: "2027-02-01" },
    ]);
  });

  it("et mindre antal fjernes fra den bageste leverance først", () => {
    expect(
      planLineAllocation({
        desired: 2,
        current: [
          { deliveryId: "d1", quantity: 1, promisedDate: "a" },
          { deliveryId: "d2", quantity: 3, promisedDate: "b" },
        ],
        startDeliveryId: "d1",
        deliveries: [D1, D2],
      }),
    ).toEqual([
      { deliveryId: "d1", quantity: 1, promisedDate: "a" },
      { deliveryId: "d2", quantity: 1, promisedDate: "b" },
    ]);
  });

  it("et mindre antal fjerner først de uafklarede stk.", () => {
    expect(
      planLineAllocation({
        desired: 2,
        current: [
          { deliveryId: "d1", quantity: 2, promisedDate: "a" },
          { deliveryId: null, quantity: 3, promisedDate: null },
        ],
        startDeliveryId: "d1",
        deliveries: [slot("d1", 1, 0), slot("d2", 2, 0)],
      }),
    ).toEqual([{ deliveryId: "d1", quantity: 2, promisedDate: "a" }]);
  });

  it("antal 0 (annulleret eller refunderet) fjerner alt", () => {
    expect(
      planLineAllocation({
        desired: 0,
        current: [
          { deliveryId: "d1", quantity: 2, promisedDate: "a" },
          { deliveryId: null, quantity: 1, promisedDate: null },
        ],
        startDeliveryId: "d1",
        deliveries: [D1, D2],
      }),
    ).toEqual([]);
  });

  it("uafklarede stk. bliver placeret, når der er kommet plads", () => {
    expect(
      planLineAllocation({
        desired: 3,
        current: [
          { deliveryId: "d1", quantity: 1, promisedDate: "a" },
          { deliveryId: null, quantity: 2, promisedDate: null },
        ],
        startDeliveryId: "d1",
        deliveries: [slot("d1", 1, 0), slot("d2", 2, 5)],
      }),
    ).toEqual([
      { deliveryId: "d1", quantity: 1, promisedDate: "a" },
      { deliveryId: "d2", quantity: 2, promisedDate: "2027-02-01" },
    ]);
  });
});
