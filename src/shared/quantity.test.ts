import { describe, expect, it } from "vitest";
import { formatQuantity, formatQuantityAmount, unitSuffix } from "./quantity";

describe("formatQuantity", () => {
  it.each([
    [12000, "piece", "12 pcs"],
    [1500, "kg", "1.500 kg"],
    [-250, "litre", "-0.250 L"],
    [0, "piece", "0 pcs"],
  ] as const)("formats %i %s as %s", (milli, unit, text) => {
    expect(formatQuantity(milli, unit)).toBe(text);
  });

  it("rejects a fractional milli-unit", () => {
    expect(() => formatQuantity(1.5, "kg")).toThrow();
  });
});

describe("formatQuantityAmount", () => {
  it.each([
    [12000, "piece", "12"],
    [1500, "kg", "1.500"],
    [-250, "litre", "-0.250"],
    [-2000, "piece", "-2"],
  ] as const)("formats %i %s as %s", (milli, unit, text) => {
    expect(formatQuantityAmount(milli, unit)).toBe(text);
  });

  it("matches formatQuantity without the suffix", () => {
    expect(formatQuantity(3333, "kg")).toBe(`${formatQuantityAmount(3333, "kg")} ${unitSuffix.kg}`);
  });
});
