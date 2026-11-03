import { describe, expect, it } from "vitest";
import { normalizeSearchText } from "./search-text";

describe("normalizeSearchText", () => {
  it("lower-cases, trims and collapses whitespace", () => {
    expect(normalizeSearchText("  Tea   Bag\t\n")).toBe("tea bag");
  });

  it("joins name, Urdu name and code", () => {
    expect(normalizeSearchText("Tapal Danedar", "ٹپال دانے دار", "TD-950")).toBe(
      "tapal danedar ٹپال دانے دار td-950",
    );
  });

  it("skips null, undefined and blank parts", () => {
    expect(normalizeSearchText("Tea", null, undefined, "   ", "X1")).toBe("tea x1");
    expect(normalizeSearchText(null, undefined, "  ")).toBe("");
  });

  it("leaves Urdu unchanged apart from whitespace", () => {
    expect(normalizeSearchText("  ٹپال   دانے  ")).toBe("ٹپال دانے");
  });
});
