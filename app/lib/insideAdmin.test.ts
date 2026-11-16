import { describe, expect, it } from "vitest";
import { insideAdmin } from "./insideAdmin";

describe("inde i Shopify Admin?", () => {
  it("ja, med App Bridges sessionstoken (fx klik på appens navn)", () => {
    expect(
      insideAdmin(
        new Request("https://app.test/", {
          headers: { Authorization: "Bearer eyJ.token" },
        }),
      ),
    ).toBe(true);
  });

  it("ja, når Shopify har sat embedded eller host i adressen", () => {
    expect(insideAdmin(new Request("https://app.test/?embedded=1"))).toBe(true);
    expect(insideAdmin(new Request("https://app.test/?host=YWRtaW4"))).toBe(
      true,
    );
  });

  it("nej, for besøgende udefra — så vises startsiden", () => {
    expect(insideAdmin(new Request("https://app.test/"))).toBe(false);
    expect(
      insideAdmin(
        new Request("https://app.test/", {
          headers: { Authorization: "Basic abc" },
        }),
      ),
    ).toBe(false);
  });
});
