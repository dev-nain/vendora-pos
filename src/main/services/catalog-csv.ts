export const catalogCsvColumns = [
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
] as const;

export interface CatalogCsvRecord {
  nameEn: string;
  nameUr: string | null;
  barcode: string | null;
  packQtyMilli: number | null;
  packPricePaisa: number | null;
  categoryName: string;
  unit: string;
  costPaisa: number;
  salePricePaisa: number;
  mrpPaisa: number | null;
  taxCategoryName: string;
  internalCode: string | null;
  brand: string | null;
  pctCode: string | null;
  lowStockThresholdMilli: number | null;
  isActive: boolean;
}

function requireWholeNumber(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Expected a non-negative integer");
  }
}

export function formatPaisa(paisa: number): string {
  requireWholeNumber(paisa);
  return `${Math.trunc(paisa / 100)}.${String(paisa % 100).padStart(2, "0")}`;
}

export function formatMilli(milli: number): string {
  requireWholeNumber(milli);
  const whole = Math.trunc(milli / 1000);
  const fraction = String(milli % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function csvCell(value: string): string {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

const orBlank = <T>(value: T | null, format: (value: T) => string): string =>
  value === null ? "" : format(value);

export function catalogCsvLine(record: CatalogCsvRecord): string {
  const cells = [
    record.nameEn,
    record.nameUr ?? "",
    record.barcode ?? "",
    orBlank(record.packQtyMilli, formatMilli),
    orBlank(record.packPricePaisa, formatPaisa),
    record.categoryName,
    record.unit,
    formatPaisa(record.costPaisa),
    formatPaisa(record.salePricePaisa),
    orBlank(record.mrpPaisa, formatPaisa),
    record.taxCategoryName,
    record.internalCode ?? "",
    record.brand ?? "",
    record.pctCode ?? "",
    orBlank(record.lowStockThresholdMilli, formatMilli),
    record.isActive ? "active" : "archived",
  ];
  return `${cells.map(csvCell).join(",")}\r\n`;
}

export const catalogCsvHeader = `${catalogCsvColumns.join(",")}\r\n`;
