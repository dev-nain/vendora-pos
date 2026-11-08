import { describe, expect, it } from "vitest";
import {
  exportTodayReportInputSchema,
  lowStockReportColumns,
  negativeStockReportColumns,
  purchasesBySupplierColumns,
  stockMovementsColumns,
  stockMovementsExportInputSchema,
  stockMovementsReportInputSchema,
  stockOnHandColumns,
  stocktakeVarianceColumns,
  stocktakeVarianceExportInputSchema,
  stocktakeVarianceReportInputSchema,
} from "./stock-reports";

const id = "0192f3a0-0000-7000-8000-000000000099";
const range = { from: "2026-11-01", to: "2026-11-07" };

describe("report column widths", () => {
  it.each([
    ["stock on hand", stockOnHandColumns],
    ["low stock", lowStockReportColumns],
    ["negative stock", negativeStockReportColumns],
    ["stock movements", stockMovementsColumns],
    ["purchases by supplier", purchasesBySupplierColumns],
    ["stocktake variance", stocktakeVarianceColumns],
  ] as const)("%s columns add up to 1,036 px", (_, columns) => {
    const widths = columns.map((column) => Number.parseFloat(column.width ?? "NaN"));
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(1036);
  });
});

describe("report input schemas", () => {
  it("accepts a format and nothing else for the today-only exports", () => {
    expect(exportTodayReportInputSchema.safeParse({ format: "csv" }).success).toBe(true);
    expect(exportTodayReportInputSchema.safeParse({ format: "xlsx" }).success).toBe(false);
    expect(exportTodayReportInputSchema.safeParse({ format: "pdf", extra: 1 }).success).toBe(false);
  });

  it("needs a uuid product and a valid range for stock movements", () => {
    expect(stockMovementsReportInputSchema.safeParse({ productId: id, range }).success).toBe(true);
    expect(stockMovementsReportInputSchema.safeParse({ productId: "x", range }).success).toBe(
      false,
    );
    expect(
      stockMovementsReportInputSchema.safeParse({
        productId: id,
        range: { from: "2026-11-08", to: "2026-11-07" },
      }).success,
    ).toBe(false);
    expect(
      stockMovementsExportInputSchema.safeParse({ productId: id, range, format: "pdf" }).success,
    ).toBe(true);
  });

  it("takes a uuid or null for the stocktake and rejects a missing key", () => {
    expect(stocktakeVarianceReportInputSchema.safeParse({ range, stocktakeId: null }).success).toBe(
      true,
    );
    expect(stocktakeVarianceReportInputSchema.safeParse({ range, stocktakeId: id }).success).toBe(
      true,
    );
    expect(stocktakeVarianceReportInputSchema.safeParse({ range }).success).toBe(false);
    expect(stocktakeVarianceReportInputSchema.safeParse({ range, stocktakeId: "x" }).success).toBe(
      false,
    );
    expect(
      stocktakeVarianceExportInputSchema.safeParse({ range, stocktakeId: null, format: "csv" })
        .success,
    ).toBe(true);
  });
});
