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

export type ReportColumn<Row> = {
  key: Extract<keyof Row, string>;
  label: string;
  width?: string;
} & ({ format: "day" | "text" | "count" | "money" } | { format: "quantity"; unit: ProductUnit });

export const isNumericColumn = <Row>(column: ReportColumn<Row>): boolean =>
  column.format !== "day" && column.format !== "text";

const MINUS = "−";

export function formatReportCell<Row>(column: ReportColumn<Row>, value: string | number): string {
  switch (column.format) {
    case "day":
      return formatStoreDay(String(value));
    case "money":
      return signedRupees(Number(value));
    case "quantity":
      return formatQuantity(Number(value), column.unit).replace("-", MINUS);
    case "count": {
      const count = Number(value);
      const grouped = String(Math.abs(count)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return count < 0 ? `${MINUS}${grouped}` : grouped;
    }
    case "text":
      return String(value);
  }
}

const countSchema = z.number().int();

export const reportFooterRowSchema = z.strictObject({
  label: z.string(),
  values: z.record(z.string(), countSchema),
});
export type ReportFooterRow = z.infer<typeof reportFooterRowSchema>;

export const roundingRowLabel = "Rounding";

export const salesByPeriodTotalsSchema = z.strictObject({
  billCount: countSchema,
  grossPaisa: countSchema,
  returnsPaisa: countSchema,
  discountPaisa: countSchema,
  netPaisa: countSchema,
  taxPaisa: countSchema,
  roundingPaisa: countSchema,
  totalPaisa: countSchema,
});
export type SalesByPeriodTotals = z.infer<typeof salesByPeriodTotalsSchema>;

export const salesByDayRowSchema = salesByPeriodTotalsSchema.extend({ day: storeDaySchema });
export type SalesByDayRow = z.infer<typeof salesByDayRowSchema>;

export const salesByDayResultSchema = z.strictObject({
  rows: z.array(salesByDayRowSchema),
  totals: salesByPeriodTotalsSchema,
});
export type SalesByDayResult = z.infer<typeof salesByDayResultSchema>;

export const salesByHourRowSchema = salesByPeriodTotalsSchema.extend({
  hour: z.string().regex(/^([01]\d|2[0-3]):00$/),
});
export type SalesByHourRow = z.infer<typeof salesByHourRowSchema>;

export const salesByHourResultSchema = z.strictObject({
  rows: z.array(salesByHourRowSchema),
  totals: salesByPeriodTotalsSchema,
});
export type SalesByHourResult = z.infer<typeof salesByHourResultSchema>;

export const hourLabel = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

const salesByPeriodColumns = [
  { key: "billCount", label: "Bills", format: "count", width: "80px" },
  { key: "grossPaisa", label: "Gross sales", format: "money", width: "136px" },
  { key: "returnsPaisa", label: "Returns", format: "money", width: "120px" },
  { key: "discountPaisa", label: "Discount", format: "money", width: "112px" },
  { key: "netPaisa", label: "Net sales", format: "money", width: "136px" },
  { key: "taxPaisa", label: "Tax", format: "money", width: "112px" },
  { key: "roundingPaisa", label: "Rounding", format: "money", width: "100px" },
  { key: "totalPaisa", label: "Total", format: "money", width: "136px" },
] as const;

export const salesByDayColumns: ReportColumn<SalesByDayRow>[] = [
  { key: "day", label: "Day", format: "day", width: "104px" },
  ...salesByPeriodColumns,
];

export const salesByHourColumns: ReportColumn<SalesByHourRow>[] = [
  { key: "hour", label: "Hour", format: "text", width: "104px" },
  ...salesByPeriodColumns,
];

export const exportReportFailedMessage =
  "Couldn't save the report. Check the folder and try again.";

export const exportReportResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), status: z.literal("saved"), path: z.string() }),
  z.strictObject({ ok: z.literal(true), status: z.literal("cancelled") }),
  z.strictObject({ ok: z.literal(false), reason: z.literal("failed"), message: z.string() }),
]);
export type ExportReportResult = z.infer<typeof exportReportResultSchema>;
