import { z } from "zod";
import { productUnits } from "./products";
import { reportExportFormats, type ReportColumn } from "./reports";

const countSchema = z.int();
const unitSchema = z.enum(productUnits);

export const exportTodayReportInputSchema = z.strictObject({
  format: z.enum(reportExportFormats),
});
export type ExportTodayReportInput = z.infer<typeof exportTodayReportInputSchema>;

const stockOnHandRowSchema = z.strictObject({
  productId: z.uuid(),
  product: z.string(),
  category: z.string(),
  unit: unitSchema,
  onHandMilli: countSchema,
  costPaisa: countSchema,
  stockValuePaisa: countSchema,
});
export type StockOnHandRow = z.infer<typeof stockOnHandRowSchema>;

export const stockOnHandResultSchema = z.strictObject({
  asOf: z.iso.datetime(),
  rows: z.array(stockOnHandRowSchema),
  totals: z.strictObject({ stockValuePaisa: countSchema }),
});
export type StockOnHandResult = z.infer<typeof stockOnHandResultSchema>;

const lowStockReportRowSchema = z.strictObject({
  productId: z.uuid(),
  product: z.string(),
  category: z.string(),
  unit: unitSchema,
  onHandMilli: countSchema,
  thresholdMilli: countSchema,
  shortfallMilli: countSchema,
});
export type LowStockReportRow = z.infer<typeof lowStockReportRowSchema>;

export const lowStockReportResultSchema = z.strictObject({
  asOf: z.iso.datetime(),
  rows: z.array(lowStockReportRowSchema),
  totals: z.strictObject({}),
});
export type LowStockReportResult = z.infer<typeof lowStockReportResultSchema>;

const negativeStockReportRowSchema = z.strictObject({
  productId: z.uuid(),
  product: z.string(),
  unit: unitSchema,
  onHandMilli: countSchema,
  stockValuePaisa: countSchema,
  lastMovementAt: z.iso.datetime(),
});
export type NegativeStockReportRow = z.infer<typeof negativeStockReportRowSchema>;

export const negativeStockReportResultSchema = z.strictObject({
  asOf: z.iso.datetime(),
  rows: z.array(negativeStockReportRowSchema),
  totals: z.strictObject({ stockValuePaisa: countSchema }),
});
export type NegativeStockReportResult = z.infer<typeof negativeStockReportResultSchema>;

export const stockOnHandColumns: ReportColumn<StockOnHandRow>[] = [
  { key: "product", label: "Product", format: "text", width: "340px" },
  { key: "category", label: "Category", format: "text", width: "180px" },
  { key: "unit", label: "Unit", format: "unit", width: "64px" },
  { key: "onHandMilli", label: "On hand", format: "quantity", unitKey: "unit", width: "120px" },
  { key: "costPaisa", label: "Average cost", format: "money", width: "136px" },
  { key: "stockValuePaisa", label: "Value", format: "money", width: "196px" },
];

export const lowStockReportColumns: ReportColumn<LowStockReportRow>[] = [
  { key: "product", label: "Product", format: "text", width: "360px" },
  { key: "category", label: "Category", format: "text", width: "200px" },
  { key: "unit", label: "Unit", format: "unit", width: "64px" },
  { key: "onHandMilli", label: "On hand", format: "quantity", unitKey: "unit", width: "136px" },
  {
    key: "thresholdMilli",
    label: "Low-stock level",
    format: "quantity",
    unitKey: "unit",
    width: "140px",
  },
  {
    key: "shortfallMilli",
    label: "Shortfall",
    format: "quantity",
    unitKey: "unit",
    width: "136px",
  },
];

export const negativeStockReportColumns: ReportColumn<NegativeStockReportRow>[] = [
  { key: "product", label: "Product", format: "text", width: "380px" },
  { key: "unit", label: "Unit", format: "unit", width: "64px" },
  { key: "onHandMilli", label: "On hand", format: "quantity", unitKey: "unit", width: "136px" },
  { key: "stockValuePaisa", label: "Value", format: "money", width: "176px" },
  { key: "lastMovementAt", label: "Last movement", format: "datetime", width: "280px" },
];
