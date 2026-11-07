import {
  salesByDayColumns,
  type ExportReportResult,
  type ReportColumn,
  type ReportExportFormat,
  type ReportRange,
  type SalesByDayRow,
  type SalesByDayTotals,
} from "@shared/reports";

export interface ReportQuery {
  range: ReportRange;
  productId: string | null;
  stocktakeId: string | null;
}

export interface LoadedReport<Row, Totals> {
  rows: Row[];
  totals: Totals;
  caption?: string | null;
}

export interface ReportDefinition<
  Row extends Record<string, string | number>,
  Totals extends Record<string, number>,
> {
  id: string;
  label: string;
  columns: ReportColumn<Row>[];
  period: "range" | "today";
  subject: "none" | "product" | "stocktake";
  emptyTitle: string;
  emptyHint: string;
  waitingText?: string;
  load: (query: ReportQuery) => Promise<LoadedReport<Row, Totals>> | null;
  exportTo: (query: ReportQuery, format: ReportExportFormat) => Promise<ExportReportResult> | null;
}

export const salesByDayReport: ReportDefinition<SalesByDayRow, SalesByDayTotals> = {
  id: "sales-by-day",
  label: "Sales by day",
  columns: salesByDayColumns,
  period: "range",
  subject: "none",
  emptyTitle: "No sales in this period",
  emptyHint: "Try another date range.",
  load: ({ range }) => window.vendora.reports.salesByDay(range),
  exportTo: ({ range }, format) => window.vendora.reports.exportSalesByDay({ range, format }),
};
