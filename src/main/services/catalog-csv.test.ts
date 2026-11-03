import { describe, expect, it } from "vitest";
import {
  catalogCsvColumns,
  catalogCsvHeader,
  catalogCsvLine,
  csvCell,
  formatMilli,
  formatPaisa,
  type CatalogCsvRecord,
} from "./catalog-csv";

const record: CatalogCsvRecord = {
  nameEn: "Tapal Danedar 950g",
  nameUr: "ٹپال دانے دار",
  barcode: "8964000123473",
  packQtyMilli: 24000,
  packPricePaisa: 3000000,
  categoryName: "Tea",
  unit: "piece",
  costPaisa: 112500,
  salePricePaisa: 125000,
  mrpPaisa: 130000,
  taxCategoryName: "Standard",
  internalCode: "T-1",
  brand: "Tapal",
  pctCode: "0902.3000",
  lowStockThresholdMilli: 2500,
  isActive: true,
};

describe("catalog csv", () => {
  it("keeps the column order", () => {
    expect(catalogCsvColumns).toEqual([
      "name",
      "name_ur",
      "barcode",
      "pack_qty",
      "pack_price",
      "category",
      "unit",
      "cost",
      "sale_price",
      "mrp",
      "tax_category",
      "internal_code",
      "brand",
      "pct_code",
      "low_stock_threshold",
      "status",
    ]);
    expect(catalogCsvHeader).toBe(`${catalogCsvColumns.join(",")}\r\n`);
  });

  it("formats paisa as rupees", () => {
    expect(formatPaisa(1250)).toBe("12.50");
    expect(formatPaisa(0)).toBe("0.00");
    expect(formatPaisa(5)).toBe("0.05");
    expect(formatPaisa(100)).toBe("1.00");
    expect(formatPaisa(125000000)).toBe("1250000.00");
    expect(() => formatPaisa(1.5)).toThrow();
    expect(() => formatPaisa(-1)).toThrow();
  });

  it("formats milli-units with trimmed decimals", () => {
    expect(formatMilli(24000)).toBe("24");
    expect(formatMilli(1000)).toBe("1");
    expect(formatMilli(1500)).toBe("1.5");
    expect(formatMilli(250)).toBe("0.25");
    expect(formatMilli(1)).toBe("0.001");
    expect(formatMilli(0)).toBe("0");
    expect(() => formatMilli(2.5)).toThrow();
  });

  it("quotes cells that need it", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("x\r\ny")).toBe('"x\r\ny"');
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("")).toBe("");
  });

  it("guards against formula injection", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+92")).toBe("'+92");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("=1,2")).toBe(`"'=1,2"`);
    expect(csvCell("a=b")).toBe("a=b");
  });

  it("builds a line in column order", () => {
    expect(catalogCsvLine(record)).toBe(
      "Tapal Danedar 950g,ٹپال دانے دار,8964000123473,24,30000.00,Tea,piece,1125.00,1250.00,1300.00,Standard,T-1,Tapal,0902.3000,2.5,active\r\n",
    );
  });

  it("blanks nulls and marks archived products", () => {
    const line = catalogCsvLine({
      ...record,
      nameUr: null,
      barcode: null,
      packQtyMilli: null,
      packPricePaisa: null,
      mrpPaisa: null,
      internalCode: null,
      brand: null,
      pctCode: null,
      lowStockThresholdMilli: null,
      isActive: false,
    });
    expect(line).toBe(
      "Tapal Danedar 950g,,,,,Tea,piece,1125.00,1250.00,,Standard,,,,,archived\r\n",
    );
  });
});
