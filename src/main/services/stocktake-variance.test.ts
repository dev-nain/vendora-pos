import { describe, expect, it } from "vitest";
import { lineVariance, varianceTotals } from "./stocktake-variance";

const valueOf = (countedMilli: number, expectedMilli: number, costPaisa: number) =>
  lineVariance({ countedMilli, expectedMilli, costPaisa }).varianceValuePaisa;

describe("lineVariance", () => {
  it("is counted minus expected, valued at cost", () => {
    expect(lineVariance({ countedMilli: 11000, expectedMilli: 12000, costPaisa: 105050 })).toEqual({
      varianceMilli: -1000,
      varianceValuePaisa: -105050,
    });
    expect(lineVariance({ countedMilli: 2000, expectedMilli: 0, costPaisa: 8500 })).toEqual({
      varianceMilli: 2000,
      varianceValuePaisa: 17000,
    });
  });

  it("is zero when counted equals expected", () => {
    expect(lineVariance({ countedMilli: 20000, expectedMilli: 20000, costPaisa: 999 })).toEqual({
      varianceMilli: 0,
      varianceValuePaisa: 0,
    });
  });

  it("values weighed quantities", () => {
    expect(lineVariance({ countedMilli: 9250, expectedMilli: 10000, costPaisa: 14333 })).toEqual({
      varianceMilli: -750,
      varianceValuePaisa: -10750,
    });
  });

  it("rounds halves away from zero on both signs", () => {
    expect(valueOf(1, 0, 500)).toBe(1);
    expect(valueOf(0, 1, 500)).toBe(-1);
    expect(valueOf(1, 0, 499)).toBe(0);
  });

  it("never returns negative zero", () => {
    expect(Object.is(valueOf(0, 1, 499), -0)).toBe(false);
  });

  it("values nothing at cost 0", () => {
    expect(lineVariance({ countedMilli: 5000, expectedMilli: 0, costPaisa: 0 })).toEqual({
      varianceMilli: 5000,
      varianceValuePaisa: 0,
    });
  });
});

describe("varianceTotals", () => {
  it("sums the rounded line values so rows add up to the totals", () => {
    const lines = [
      lineVariance({ countedMilli: 11000, expectedMilli: 12000, costPaisa: 105050 }),
      lineVariance({ countedMilli: 9250, expectedMilli: 10000, costPaisa: 14333 }),
      lineVariance({ countedMilli: 2000, expectedMilli: 0, costPaisa: 8500 }),
      lineVariance({ countedMilli: 3000, expectedMilli: 3000, costPaisa: 25000 }),
    ];

    expect(varianceTotals(lines)).toEqual({
      varianceLineCount: 3,
      shortValuePaisa: -115800,
      surplusValuePaisa: 17000,
      netValuePaisa: -98800,
    });
  });

  it("is all zero with no lines", () => {
    expect(varianceTotals([])).toEqual({
      varianceLineCount: 0,
      shortValuePaisa: 0,
      surplusValuePaisa: 0,
      netValuePaisa: 0,
    });
  });

  it("counts a variance with no value as a variance line", () => {
    expect(
      varianceTotals([lineVariance({ countedMilli: 5000, expectedMilli: 0, costPaisa: 0 })]),
    ).toMatchObject({ varianceLineCount: 1, netValuePaisa: 0 });
  });
});
