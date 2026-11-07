import { describe, expect, it } from "vitest";
import { computeBill, type TotalsLine } from "../checkout/totals";
import { exTaxPricePaisa, isBelowThreshold, marginBps } from "./margin";

describe("margin", () => {
  it("tax-exclusive: 10,000 price and 8,000 cost is 2000 bps", () => {
    const exTax = exTaxPricePaisa(1_000_000, 1800, false);
    expect(exTax).toBe(1_000_000);
    expect(marginBps(exTax, 800_000)).toBe(2000);
    expect(isBelowThreshold(exTax, 800_000, 2000)).toBe(false);
    expect(isBelowThreshold(exTax, 800_000, 2001)).toBe(true);
  });

  it("one paisa of extra cost falls below the threshold", () => {
    expect(isBelowThreshold(1_000_000, 800_001, 2000)).toBe(true);
  });

  it("tax-inclusive at 18%: 11,800 is 10,000 ex-tax", () => {
    const exTax = exTaxPricePaisa(1_180_000, 1800, true);
    expect(exTax).toBe(1_000_000);
    expect(marginBps(exTax, 800_000)).toBe(2000);
    expect(isBelowThreshold(exTax, 800_000, 2000)).toBe(false);
    expect(isBelowThreshold(exTax, 800_001, 2000)).toBe(true);
  });

  it("extracts tax like computeBill for a one-line bill", () => {
    for (const price of [1, 99, 100, 1234, 11_800, 125_000, 999_999]) {
      for (const rate of [0, 500, 1800, 2500, 10000]) {
        const line: TotalsLine = {
          id: "a",
          position: 1,
          isReturn: false,
          qtyMilli: 1000,
          unitPricePaisa: price,
          fixedGrossPaisa: null,
          fixedAmounts: null,
          discount: null,
          taxRateBps: rate,
        };
        const bill = computeBill({
          lines: [line],
          billDiscount: null,
          pricesIncludeTax: true,
          rounding: { mode: "off", unitPaisa: 100 },
        });
        expect(exTaxPricePaisa(price, rate, true)).toBe(price - bill.totals.taxPaisa);
      }
    }
  });

  it("a cost above the ex-tax price is a negative margin and below zero", () => {
    expect(marginBps(10_000, 10_325)).toBe(-325);
    expect(isBelowThreshold(10_000, 10_325, 0)).toBe(true);
  });

  it("a zero price has no margin and is always listed", () => {
    expect(marginBps(0, 0)).toBeNull();
    expect(isBelowThreshold(0, 0, 0)).toBe(true);
  });

  it("1 paisa at 100% inclusive is 0 ex-tax", () => {
    const exTax = exTaxPricePaisa(1, 10000, true);
    expect(exTax).toBe(0);
    expect(marginBps(exTax, 0)).toBeNull();
    expect(isBelowThreshold(exTax, 0, 0)).toBe(true);
  });

  it("compares exactly, not on the rounded display", () => {
    expect(marginBps(30000, 20002)).toBe(3333);
    expect(isBelowThreshold(30000, 20002, 3333)).toBe(true);
    expect(isBelowThreshold(30000, 20000, 3333)).toBe(false);
  });

  it("throws on non-integer input", () => {
    expect(() => exTaxPricePaisa(1.5, 1800, true)).toThrow();
    expect(() => exTaxPricePaisa(100, 18.5, true)).toThrow();
    expect(() => marginBps(100.5, 10)).toThrow();
    expect(() => marginBps(100, 10.5)).toThrow();
    expect(() => isBelowThreshold(100, 10, 20.5)).toThrow();
  });
});
