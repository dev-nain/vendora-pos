import {
  salesByDayColumns,
  type ExportReportInput,
  type ExportReportResult,
  type ReportColumn,
  type ReportFooterRow,
  type ReportRange,
  type SalesByDayResult,
  type SalesByDayRow,
  type SalesByPeriodTotals,
} from "@shared/reports";

export interface ReportDefinition<
  Row extends Record<string, string | number>,
  Totals extends Record<string, number>,
> {
  id: string;
  label: string;
  columns: ReportColumn<Row>[];
  load: (
    range: ReportRange,
  ) => Promise<{ rows: Row[]; totals: Totals; footer?: ReportFooterRow[] }>;
  exportTo: (input: ExportReportInput) => Promise<ExportReportResult>;
}

export const salesByDayReport: ReportDefinition<SalesByDayRow, SalesByPeriodTotals> = {
  id: "sales-by-day",
  label: "Sales by day",
  columns: salesByDayColumns,
  load: (range): Promise<SalesByDayResult> => window.vendora.reports.salesByDay(range),
  exportTo: (input) => window.vendora.reports.exportSalesByDay(input),
};

export const reportDefinitions = [salesByDayReport] as const;
