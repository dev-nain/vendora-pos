import { describe, expect, it } from "vitest";
import { stockValuePaisa } from "./stock-value";

describe("stockValuePaisa", () => {
  it("values whole and weighed quantities", () => {
    expect(stockValuePaisa(3000, 105050)).toBe(315150);
    expect(stockValuePaisa(1250, 14333)).toBe(17916);
  });

  it("rounds halves away from zero", () => {
    expect(stockValuePaisa(500, 1)).toBe(1);
    expect(stockValuePaisa(-500, 1)).toBe(-1);
  });

  it("rounds below half to zero without negative zero", () => {
    expect(stockValuePaisa(1, 499)).toBe(0);
    expect(Object.is(stockValuePaisa(-1, 499), 0)).toBe(true);
  });

  it("values zero stock and zero cost as zero", () => {
    expect(stockValuePaisa(0, 105050)).toBe(0);
    expect(stockValuePaisa(5000, 0)).toBe(0);
  });

  it("values negative stock", () => {
    expect(stockValuePaisa(-3000, 105050)).toBe(-315150);
  });

  it("stays exact when the product passes 2^53", () => {
    expect(stockValuePaisa(2 ** 40, 2 ** 20)).toBe(1152921504606847);
  });

  it("throws when the result is outside the safe range", () => {
    expect(() => stockValuePaisa(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toThrow();
  });

  it("rejects non-integers", () => {
    expect(() => stockValuePaisa(1.5, 100)).toThrow();
    expect(() => stockValuePaisa(1000, 1.5)).toThrow();
  });
});
