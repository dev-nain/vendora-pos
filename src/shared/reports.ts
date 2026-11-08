import { z } from "zod";
import { signedRupees } from "./money";
import type { ProductUnit } from "./products";
import { formatQuantity } from "./quantity";

export const storeUtcOffsetMs = 5 * 60 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;

export const storeDaySchema = z.iso.date();

export const reportRangeSchema = z
  .strictObject({ from: storeDaySchema, to: storeDaySchema })
  .refine((range) => range.from <= range.to, { message: "Start date is after end date" });
export type ReportRange = z.infer<typeof reportRangeSchema>;

export const reportExportFormats = ["csv", "pdf"] as const;
export type ReportExportFormat = (typeof reportExportFormats)[number];

export const exportReportInputSchema = z.strictObject({
  range: reportRangeSchema,
  format: z.enum(reportExportFormats),
});
export type ExportReportInput = z.infer<typeof exportReportInputSchema>;

export const reportPresets = ["today", "yesterday", "this-week", "this-month", "custom"] as const;
export type ReportPreset = (typeof reportPresets)[number];

export const reportPresetLabels: Record<ReportPreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "this-week": "This week",
  "this-month": "This month",
  custom: "Custom",
};

const dayStartUtc = (day: string): number => Date.parse(`${day}T00:00:00.000Z`);
const dayFromUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function storeToday(now: Date): string {
  return dayFromUtc(now.getTime() + storeUtcOffsetMs);
}

export function presetRange(preset: Exclude<ReportPreset, "custom">, now: Date): ReportRange {
  const today = storeToday(now);
  const todayMs = dayStartUtc(today);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const yesterday = dayFromUtc(todayMs - dayMs);
      return { from: yesterday, to: yesterday };
    }
    case "this-week":
      return { from: dayFromUtc(todayMs - new Date(todayMs).getUTCDay() * dayMs), to: today };
    case "this-month":
      return { from: `${today.slice(0, 8)}01`, to: today };
  }
}

export function storeDayBounds(range: ReportRange): { start: Date; end: Date } {
  return {
    start: new Date(dayStartUtc(range.from) - storeUtcOffsetMs),
    end: new Date(dayStartUtc(range.to) + dayMs - storeUtcOffsetMs),
  };
}

export function storeDayOfBucket(bucket: number): string {
  return dayFromUtc(bucket * dayMs);
}

const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatStoreDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return `${date} ${monthNames[(month ?? 1) - 1]} ${year}`;
}

export function formatRangeLabel(range: ReportRange): string {
  return range.from === range.to
    ? formatStoreDay(range.from)
    : `${formatStoreDay(range.from)} – ${formatStoreDay(range.to)}`;
}

export type ReportCellValue = string | number | null;

export type ReportColumn<Row> = {
  key: Extract<keyof Row, string>;
  label: string;
  width?: string;
} & (
  | { format: "day" | "text" | "count" | "money" | "time" | "percent" }
  | { format: "invoice"; linkKey?: Extract<keyof Row, string> }
  | { format: "quantity"; unit: ProductUnit }
  | { format: "quantity"; unitKey: Extract<keyof Row, string> }
);

export const isNumericColumn = <Row>(column: ReportColumn<Row>): boolean =>
  column.format !== "day" &&
  column.format !== "text" &&
  column.format !== "time" &&
  column.format !== "invoice";

const MINUS = "−";
const EMPTY_CELL = "—";

export function formatPercentBps(bps: number): string {
  const magnitude = Math.abs(Math.trunc(bps));
  const hundredths = String(magnitude % 100).padStart(2, "0");
  return `${bps < 0 ? MINUS : ""}${Math.trunc(magnitude / 100)}.${hundredths}%`;
}

const pad = (value: number): string => String(value).padStart(2, "0");

function storeTimeParts(iso: string) {
  const local = new Date(Date.parse(iso) + storeUtcOffsetMs);
  return {
    day: local.toISOString().slice(0, 10),
    clock: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
  };
}

export function formatStoreTime(iso: string): string {
  const { day, clock } = storeTimeParts(iso);
  return `${formatStoreDay(day)}, ${clock}`;
}

export function formatStoreTimeCsv(iso: string): string {
  const { day, clock } = storeTimeParts(iso);
  return `${day} ${clock}`;
}

export function formatReportCell<Row>(
  column: ReportColumn<Row>,
  value: ReportCellValue,
  row?: Partial<Record<string, ReportCellValue>>,
): string {
  if (value === null) return EMPTY_CELL;
  switch (column.format) {
    case "day":
      return formatStoreDay(String(value));
    case "time":
      return formatStoreTime(String(value));
    case "money":
      return signedRupees(Number(value));
    case "quantity": {
      const unit =
        "unitKey" in column
          ? ((row?.[column.unitKey] as ProductUnit | undefined) ?? "piece")
          : column.unit;
      return formatQuantity(Number(value), unit).replace("-", MINUS);
    }
    case "count": {
      const count = Number(value);
      const grouped = String(Math.abs(count)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return count < 0 ? `${MINUS}${grouped}` : grouped;
    }
    case "percent":
      return formatPercentBps(Number(value));
    case "text":
    case "invoice":
      return String(value);
  }
}

const countSchema = z.number().int();

export const reportFooterRowSchema = z.strictObject({
  label: z.string(),
  values: z.record(z.string(), countSchema),
});
export type ReportFooterRow = z.infer<typeof reportFooterRowSchema>;

export const salesByDayTotalsSchema = z.strictObject({
  billCount: countSchema,
  pieceQtyMilli: countSchema,
  kgQtyMilli: countSchema,
  litreQtyMilli: countSchema,
  discountPaisa: countSchema,
  netPaisa: countSchema,
  taxPaisa: countSchema,
  roundingPaisa: countSchema,
  totalPaisa: countSchema,
});
export type SalesByDayTotals = z.infer<typeof salesByDayTotalsSchema>;

export const salesByDayRowSchema = salesByDayTotalsSchema.extend({ day: storeDaySchema });
export type SalesByDayRow = z.infer<typeof salesByDayRowSchema>;

export const salesByDayResultSchema = z.strictObject({
  rows: z.array(salesByDayRowSchema),
  totals: salesByDayTotalsSchema,
});
export type SalesByDayResult = z.infer<typeof salesByDayResultSchema>;

export const salesByDayColumns: ReportColumn<SalesByDayRow>[] = [
  { key: "day", label: "Day", format: "day", width: "96px" },
  { key: "billCount", label: "Bills", format: "count", width: "64px" },
  { key: "pieceQtyMilli", label: "Pieces", format: "quantity", unit: "piece", width: "100px" },
  { key: "kgQtyMilli", label: "Kg", format: "quantity", unit: "kg", width: "108px" },
  { key: "litreQtyMilli", label: "Litres", format: "quantity", unit: "litre", width: "100px" },
  { key: "discountPaisa", label: "Discount", format: "money", width: "108px" },
  { key: "netPaisa", label: "Net sales", format: "money", width: "136px" },
  { key: "taxPaisa", label: "Tax", format: "money", width: "108px" },
  { key: "roundingPaisa", label: "Rounding", format: "money", width: "80px" },
  { key: "totalPaisa", label: "Total", format: "money", width: "136px" },
];

export const salesTaxSummaryTotalsSchema = z.strictObject({
  taxablePaisa: countSchema,
  taxPaisa: countSchema,
  totalPaisa: countSchema,
});
export type SalesTaxSummaryTotals = z.infer<typeof salesTaxSummaryTotalsSchema>;

export const salesTaxSummaryRowSchema = salesTaxSummaryTotalsSchema.extend({ rate: z.string() });
export type SalesTaxSummaryRow = z.infer<typeof salesTaxSummaryRowSchema>;

export const salesTaxSummaryResultSchema = z.strictObject({
  rows: z.array(salesTaxSummaryRowSchema),
  totals: salesTaxSummaryTotalsSchema,
});
export type SalesTaxSummaryResult = z.infer<typeof salesTaxSummaryResultSchema>;

export const salesTaxSummaryColumns: ReportColumn<SalesTaxSummaryRow>[] = [
  { key: "rate", label: "Tax rate", format: "text", width: "340px" },
  { key: "taxablePaisa", label: "Taxable value", format: "money", width: "232px" },
  { key: "taxPaisa", label: "Tax", format: "money", width: "232px" },
  { key: "totalPaisa", label: "Total", format: "money", width: "232px" },
];

export const miscItemsLabel = "Misc items (no cost)";
export const roundingRowLabel = "Rounding";

const optionalCountSchema = countSchema.nullable();

export const grossProfitTotalsSchema = z.strictObject({
  pieceQtyMilli: countSchema,
  kgQtyMilli: countSchema,
  litreQtyMilli: countSchema,
  netPaisa: countSchema,
  costPaisa: countSchema,
  grossProfitPaisa: countSchema,
  marginBps: optionalCountSchema,
});
export type GrossProfitTotals = z.infer<typeof grossProfitTotalsSchema>;

const grossProfitLine = {
  pieceQtyMilli: countSchema,
  kgQtyMilli: countSchema,
  litreQtyMilli: countSchema,
  netPaisa: countSchema,
  costPaisa: optionalCountSchema,
  grossProfitPaisa: optionalCountSchema,
  marginBps: optionalCountSchema,
};

export const grossProfitByProductRowSchema = z.strictObject({
  product: z.string(),
  ...grossProfitLine,
});
export type GrossProfitByProductRow = z.infer<typeof grossProfitByProductRowSchema>;

export const grossProfitByCategoryRowSchema = z.strictObject({
  category: z.string(),
  ...grossProfitLine,
});
export type GrossProfitByCategoryRow = z.infer<typeof grossProfitByCategoryRowSchema>;

export const grossProfitByProductResultSchema = z.strictObject({
  rows: z.array(grossProfitByProductRowSchema),
  totals: grossProfitTotalsSchema,
  footer: z.array(reportFooterRowSchema),
});
export type GrossProfitByProductResult = z.infer<typeof grossProfitByProductResultSchema>;

export const grossProfitByCategoryResultSchema = z.strictObject({
  rows: z.array(grossProfitByCategoryRowSchema),
  totals: grossProfitTotalsSchema,
  footer: z.array(reportFooterRowSchema),
});
export type GrossProfitByCategoryResult = z.infer<typeof grossProfitByCategoryResultSchema>;

const grossProfitNumericColumns = [
  { key: "pieceQtyMilli", label: "Pieces", format: "quantity", unit: "piece", width: "96px" },
  { key: "kgQtyMilli", label: "Kg", format: "quantity", unit: "kg", width: "104px" },
  { key: "litreQtyMilli", label: "Litres", format: "quantity", unit: "litre", width: "96px" },
  { key: "netPaisa", label: "Net sales", format: "money", width: "136px" },
  { key: "costPaisa", label: "Cost", format: "money", width: "128px" },
  { key: "grossProfitPaisa", label: "Gross profit", format: "money", width: "136px" },
  { key: "marginBps", label: "Margin", format: "percent", width: "80px" },
] as const satisfies ReportColumn<GrossProfitByProductRow>[];

export const grossProfitByProductColumns: ReportColumn<GrossProfitByProductRow>[] = [
  { key: "product", label: "Product", format: "text", width: "260px" },
  ...grossProfitNumericColumns,
];

export const grossProfitByCategoryColumns: ReportColumn<GrossProfitByCategoryRow>[] = [
  { key: "category", label: "Category", format: "text", width: "260px" },
  ...grossProfitNumericColumns,
];

export const exportReportFailedMessage =
  "Couldn't save the report. Check the folder and try again.";

export const exportReportResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), status: z.literal("saved"), path: z.string() }),
  z.strictObject({ ok: z.literal(true), status: z.literal("cancelled") }),
  z.strictObject({ ok: z.literal(false), reason: z.literal("failed"), message: z.string() }),
]);
export type ExportReportResult = z.infer<typeof exportReportResultSchema>;
