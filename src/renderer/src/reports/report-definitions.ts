import {
  salesByDayColumns,
  salesTaxSummaryColumns,
  type ExportReportInput,
  type ExportReportResult,
  type ReportColumn,
  type ReportRange,
  type SalesByDayResult,
  type SalesByDayRow,
  type SalesByDayTotals,
  type SalesTaxSummaryResult,
  type SalesTaxSummaryRow,
  type SalesTaxSummaryTotals,
} from "@shared/reports";

export interface ReportDefinition<
  Row extends Record<string, string | number>,
  Totals extends Record<string, number>,
> {
  id: string;
  label: string;
  columns: ReportColumn<Row>[];
  load: (range: ReportRange) => Promise<{ rows: Row[]; totals: Totals }>;
  exportTo: (input: ExportReportInput) => Promise<ExportReportResult>;
}

export const salesByDayReport: ReportDefinition<SalesByDayRow, SalesByDayTotals> = {
  id: "sales-by-day",
  label: "Sales by day",
  columns: salesByDayColumns,
  load: (range): Promise<SalesByDayResult> => window.vendora.reports.salesByDay(range),
  exportTo: (input) => window.vendora.reports.exportSalesByDay(input),
};

export const salesTaxSummaryReport: ReportDefinition<SalesTaxSummaryRow, SalesTaxSummaryTotals> = {
  id: "sales-tax-summary",
  label: "Sales tax summary",
  columns: salesTaxSummaryColumns,
  load: (range): Promise<SalesTaxSummaryResult> => window.vendora.reports.salesTaxSummary(range),
  exportTo: (input) => window.vendora.reports.exportSalesTaxSummary(input),
};
