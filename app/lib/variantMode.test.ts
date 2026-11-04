import { describe, expect, it } from "vitest";
import { decideMode, type ModeInput } from "./variantMode";

const base: ModeInput = {
  mode: "STOCK",
  forced: false,
  available: 10,
  syncedAvailable: null,
  hasSpace: true,
  owed: 0,
  stockBeforeForce: null,
  receivedWhileForced: 0,
};

describe("lagermode → forudbestilling", () => {
  it("skifter, når lageret rammer 0, og der er plads i en leverance", () => {
    expect(decideMode({ ...base, available: 0 })).toMatchObject({
      mode: "PREORDER",
      changed: true,
    });
  });

  it("bliver i lagermode, så længe der er varer", () => {
    expect(decideMode({ ...base, available: 1 })).toMatchObject({
      mode: "STOCK",
      changed: false,
    });
  });

  it("bliver i lagermode, når der ingen plads er i nogen leverance", () => {
    expect(
      decideMode({ ...base, available: 0, hasSpace: false }),
    ).toMatchObject({
      mode: "STOCK",
      changed: false,
    });
  });
});

describe("forudbestilling → lagermode", () => {
  const preorder: ModeInput = {
    ...base,
    mode: "PREORDER",
    available: 40,
    syncedAvailable: 40,
  };

  it("bliver i forudbestilling, når lageret står, hvor appen satte det", () => {
    expect(decideMode(preorder)).toMatchObject({
      mode: "PREORDER",
      changed: false,
    });
  });

  it("bliver i forudbestilling, når salg har trukket lageret ned", () => {
    expect(decideMode({ ...preorder, available: 35 })).toMatchObject({
      mode: "PREORDER",
    });
  });

  it("skifter, når der kommer rigtige varer ind", () => {
    expect(decideMode({ ...preorder, available: 60 })).toEqual({
      mode: "STOCK",
      changed: true,
      reason: "Der kom 20 stk. på lager.",
      stockAvailable: 20,
    });
  });

  it("varerne går først til forudbestillingerne; kun resten sælges", () => {
    expect(
      decideMode({ ...preorder, available: 190, owed: 149 }),
    ).toMatchObject({
      mode: "STOCK",
      stockAvailable: 1,
    });
  });

  it("dækker varerne ikke forudbestillingerne, bliver varianten i forudbestilling", () => {
    expect(
      decideMode({ ...preorder, available: 140, owed: 149 }),
    ).toMatchObject({
      mode: "PREORDER",
      changed: false,
    });
  });

  it("en refundering med genopfyldning (+1) skifter ikke, når der er forudbestillinger", () => {
    expect(decideMode({ ...preorder, available: 41, owed: 5 })).toMatchObject({
      mode: "PREORDER",
    });
  });
});

describe("tvunget forudbestilling", () => {
  it("tvinger forudbestilling, selvom der er lager", () => {
    expect(decideMode({ ...base, forced: true, available: 3 })).toMatchObject({
      mode: "PREORDER",
      changed: true,
      reason: "Tvunget i forudbestilling af webshopejeren.",
    });
  });

  it("bliver i forudbestilling, så længe den er tvunget, også når varer kommer ind", () => {
    expect(
      decideMode({
        ...base,
        mode: "PREORDER",
        forced: true,
        available: 500,
        syncedAvailable: 10,
      }),
    ).toMatchObject({ mode: "PREORDER", changed: false });
  });

  it("slås tvangen fra, gives lageret fra før tilbage", () => {
    expect(
      decideMode({
        ...base,
        mode: "PREORDER",
        available: 8,
        syncedAvailable: 8,
        stockBeforeForce: 3,
      }),
    ).toMatchObject({ mode: "STOCK", changed: true, stockAvailable: 3 });
  });

  it("varer lagt på lager under tvangen gives tilbage — efter forudbestillingerne", () => {
    expect(
      decideMode({
        ...base,
        mode: "PREORDER",
        available: 8,
        syncedAvailable: 8,
        stockBeforeForce: 3,
        receivedWhileForced: 20,
        owed: 5,
      }),
    ).toMatchObject({ mode: "STOCK", stockAvailable: 3 + 15 });
  });

  it("var der intet lager før tvangen, bliver varianten i forudbestilling", () => {
    expect(
      decideMode({
        ...base,
        mode: "PREORDER",
        available: 8,
        syncedAvailable: 8,
        stockBeforeForce: 0,
      }),
    ).toMatchObject({ mode: "PREORDER", changed: false });
  });
});
