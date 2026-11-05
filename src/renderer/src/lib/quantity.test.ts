import { describe, expect, it } from "vitest";
import { formatQuantity, parseQuantityMilli, quantityInputText } from "./quantity";

describe("parseQuantityMilli", () => {
  it.each([
    ["1.25", "kg", 1250],
    ["0.001", "kg", 1],
    ["2", "litre", 2000],
    ["25.5", "kg", 25500],
    ["24", "piece", 24000],
    ["1", "piece", 1000],
  ] as const)("parses %j %s as %i", (text, unit, milli) => {
    expect(parseQuantityMilli(text, unit)).toEqual({ ok: true, milli });
  });

  it.each(["1.2345", "", "-1", ".5", "1,5"])("rejects %j for kg", (text) => {
    expect(parseQuantityMilli(text, "kg")).toEqual({ ok: false });
  });

  it("rejects decimals for pieces", () => {
    expect(parseQuantityMilli("1.5", "piece")).toEqual({ ok: false });
  });
});

describe("quantityInputText", () => {
  it.each([
    [25500, "kg", "25.5"],
    [1000, "kg", "1"],
    [1, "litre", "0.001"],
    [24000, "piece", "24"],
  ] as const)("writes %i %s as %j", (milli, unit, text) => {
    expect(quantityInputText(milli, unit)).toBe(text);
  });

  it("rejects fractional milli-units", () => {
    expect(() => quantityInputText(1.5, "kg")).toThrow();
  });
});

describe("formatQuantity", () => {
  it.each([
    [12000, "piece", "12 pcs"],
    [0, "piece", "0 pcs"],
    [-3000, "piece", "-3 pcs"],
    [1250, "kg", "1.250 kg"],
    [1, "litre", "0.001 L"],
    [25000, "kg", "25.000 kg"],
  ] as const)("writes %i %s as %j", (milli, unit, text) => {
    expect(formatQuantity(milli, unit)).toBe(text);
  });
});
