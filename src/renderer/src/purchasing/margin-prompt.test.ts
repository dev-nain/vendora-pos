import { describe, expect, it } from "vitest";
import type { LowMarginItem } from "@shared/goods-received";
import { amountMessage } from "../products/product-form";
import { formatMarginBps, initialRows, plannedChanges } from "./margin-prompt";

const item = (overrides: Partial<LowMarginItem> = {}): LowMarginItem => ({
  productId: "p1",
  nameEn: "Tapal",
  nameUr: null,
  unit: "piece",
  costPaisa: 105000,
  salePricePaisa: 125000,
  mrpPaisa: 130000,
  marginBps: 88,
  ...overrides,
});

describe("formatMarginBps", () => {
  it.each([
    [null, "n/a"],
    [0, "0%"],
    [1250, "12.5%"],
    [2000, "20%"],
    [-325, "−3.25%"],
    [3333, "33.33%"],
  ])("formats %s as %s", (bps, text) => {
    expect(formatMarginBps(bps)).toBe(text);
  });
});

describe("initialRows", () => {
  it("starts each new price at the current sale price", () => {
    const rows = initialRows([item(), item({ productId: "p2", salePricePaisa: 0 })]);
    expect(rows.map((row) => row.newPrice)).toEqual(["1250", "0"]);
    expect(rows[0]?.item.productId).toBe("p1");
  });
});

describe("plannedChanges", () => {
  it("sends nothing for untouched rows", () => {
    expect(plannedChanges(initialRows([item(), item({ productId: "p2" })]))).toEqual({
      changes: [],
      errors: {},
    });
  });

  it("plans one change for an edited row", () => {
    const [first, second] = initialRows([item(), item({ productId: "p2" })]);
    const result = plannedChanges([{ ...first!, newPrice: "1290.50" }, second!]);
    expect(result).toEqual({
      changes: [{ productId: "p1", salePricePaisa: 129050 }],
      errors: {},
    });
  });

  it("reports bad text on that row", () => {
    const [first] = initialRows([item()]);
    expect(plannedChanges([{ ...first!, newPrice: "12x" }])).toEqual({
      changes: [],
      errors: { p1: amountMessage },
    });
  });

  it("treats an equal price after parsing as no change", () => {
    const [first] = initialRows([item()]);
    expect(plannedChanges([{ ...first!, newPrice: "1250.00" }])).toEqual({
      changes: [],
      errors: {},
    });
  });
});
