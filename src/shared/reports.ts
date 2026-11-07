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

export const paymentMethodsQuerySchema = z.union([
  z.strictObject({ range: reportRangeSchema }),
  z.strictObject({ shiftId: z.uuid() }),
]);
export type PaymentMethodsQuery = z.infer<typeof paymentMethodsQuerySchema>;

export const exportPaymentMethodsInputSchema = z.union([
  exportReportInputSchema,
  z.strictObject({ shiftId: z.uuid(), format: z.enum(reportExportFormats) }),
]);
export type ExportPaymentMethodsInput = z.infer<typeof exportPaymentMethodsInputSchema>;

export const reportShiftSchema = z.strictObject({
  id: z.uuid(),
  openedAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  openedBy: z.string(),
});
export type ReportShift = z.infer<typeof reportShiftSchema>;

export const reportShiftListSchema = z.array(reportShiftSchema);

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

export function storeDateTime(iso: string): { day: string; time: string } {
  const local = new Date(Date.parse(iso) + storeUtcOffsetMs).toISOString();
  return { day: local.slice(0, 10), time: local.slice(11, 16) };
}

export function formatShiftLabel(shift: ReportShift): string {
  const opened = storeDateTime(shift.openedAt);
  const start = `${formatStoreDay(opened.day)} ${opened.time}`;
  let end = "open";
  if (shift.closedAt !== null) {
    const closed = storeDateTime(shift.closedAt);
    end = closed.day === opened.day ? closed.time : `${formatStoreDay(closed.day)} ${closed.time}`;
  }
  return `${start} – ${end} · ${shift.openedBy}`;
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

export const miscItemsLabel = "Misc items";
export const noCategoryLabel = "No category";

const salesByLineTotalsSchema = z.strictObject({
  pieceQtyMilli: countSchema,
  kgQtyMilli: countSchema,
  litreQtyMilli: countSchema,
  grossPaisa: countSchema,
  returnsPaisa: countSchema,
  netPaisa: countSchema,
});
export type SalesByLineTotals = z.infer<typeof salesByLineTotalsSchema>;

export const salesByProductRowSchema = salesByLineTotalsSchema.extend({ product: z.string() });
export type SalesByProductRow = z.infer<typeof salesByProductRowSchema>;

export const salesByProductResultSchema = z.strictObject({
  rows: z.array(salesByProductRowSchema),
  totals: salesByLineTotalsSchema,
  footer: z.array(reportFooterRowSchema),
});
export type SalesByProductResult = z.infer<typeof salesByProductResultSchema>;

export const salesByCategoryRowSchema = salesByLineTotalsSchema.extend({ category: z.string() });
export type SalesByCategoryRow = z.infer<typeof salesByCategoryRowSchema>;

export const salesByCategoryResultSchema = z.strictObject({
  rows: z.array(salesByCategoryRowSchema),
  totals: salesByLineTotalsSchema,
  footer: z.array(reportFooterRowSchema),
});
export type SalesByCategoryResult = z.infer<typeof salesByCategoryResultSchema>;

export const salesByCashierTotalsSchema = z.strictObject({
  billCount: countSchema,
  grossPaisa: countSchema,
  returnsPaisa: countSchema,
  netPaisa: countSchema,
});
export type SalesByCashierTotals = z.infer<typeof salesByCashierTotalsSchema>;

export const salesByCashierRowSchema = salesByCashierTotalsSchema.extend({ cashier: z.string() });
export type SalesByCashierRow = z.infer<typeof salesByCashierRowSchema>;

export const salesByCashierResultSchema = z.strictObject({
  rows: z.array(salesByCashierRowSchema),
  totals: salesByCashierTotalsSchema,
  footer: z.array(reportFooterRowSchema),
});
export type SalesByCashierResult = z.infer<typeof salesByCashierResultSchema>;

const salesByLineColumns = [
  { key: "pieceQtyMilli", label: "Pieces", format: "quantity", unit: "piece", width: "96px" },
  { key: "kgQtyMilli", label: "Kg", format: "quantity", unit: "kg", width: "104px" },
  { key: "litreQtyMilli", label: "Litres", format: "quantity", unit: "litre", width: "96px" },
  { key: "grossPaisa", label: "Gross sales", format: "money", width: "160px" },
  { key: "returnsPaisa", label: "Returns", format: "money", width: "144px" },
  { key: "netPaisa", label: "Net sales", format: "money", width: "176px" },
] as const;

export const salesByProductColumns: ReportColumn<SalesByProductRow>[] = [
  { key: "product", label: "Product", format: "text", width: "260px" },
  ...salesByLineColumns,
];

export const salesByCategoryColumns: ReportColumn<SalesByCategoryRow>[] = [
  { key: "category", label: "Category", format: "text", width: "260px" },
  ...salesByLineColumns,
];

export const salesByCashierColumns: ReportColumn<SalesByCashierRow>[] = [
  { key: "cashier", label: "Cashier", format: "text", width: "340px" },
  { key: "billCount", label: "Bills", format: "count", width: "120px" },
  { key: "grossPaisa", label: "Gross sales", format: "money", width: "192px" },
  { key: "returnsPaisa", label: "Returns", format: "money", width: "192px" },
  { key: "netPaisa", label: "Net sales", format: "money", width: "192px" },
];

export const paymentMethodTotalsSchema = z.strictObject({
  receivedPaisa: countSchema,
  refundedPaisa: countSchema,
  netPaisa: countSchema,
});
export type PaymentMethodTotals = z.infer<typeof paymentMethodTotalsSchema>;

export const paymentMethodRowSchema = paymentMethodTotalsSchema.extend({ method: z.string() });
export type PaymentMethodRow = z.infer<typeof paymentMethodRowSchema>;

export const paymentMethodsResultSchema = z.strictObject({
  rows: z.array(paymentMethodRowSchema),
  totals: paymentMethodTotalsSchema,
});
export type PaymentMethodsResult = z.infer<typeof paymentMethodsResultSchema>;

export const paymentMethodColumns: ReportColumn<PaymentMethodRow>[] = [
  { key: "method", label: "Method", format: "text", width: "316px" },
  { key: "receivedPaisa", label: "Received", format: "money", width: "240px" },
  { key: "refundedPaisa", label: "Refunded", format: "money", width: "240px" },
  { key: "netPaisa", label: "Net", format: "money", width: "240px" },
];

export const exportReportFailedMessage =
  "Couldn't save the report. Check the folder and try again.";

export const exportReportResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), status: z.literal("saved"), path: z.string() }),
  z.strictObject({ ok: z.literal(true), status: z.literal("cancelled") }),
  z.strictObject({ ok: z.literal(false), reason: z.literal("failed"), message: z.string() }),
]);
export type ExportReportResult = z.infer<typeof exportReportResultSchema>;
