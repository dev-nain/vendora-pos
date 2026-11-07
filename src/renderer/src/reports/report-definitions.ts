import {
  grossProfitByCategoryColumns,
  grossProfitByProductColumns,
  salesByDayColumns,
  type GrossProfitByCategoryRow,
  type GrossProfitByProductRow,
  type GrossProfitTotals,
  type ExportReportInput,
  type ExportReportResult,
  type ReportCellValue,
  type ReportColumn,
  type ReportFooterRow,
  type ReportRange,
  type SalesByDayResult,
  type SalesByDayRow,
  type SalesByDayTotals,
} from "@shared/reports";

export interface ReportDefinition<
  Row extends Record<string, ReportCellValue>,
  Totals extends Record<string, number | null>,
> {
  id: string;
  label: string;
  columns: ReportColumn<Row>[];
  load: (
    range: ReportRange,
  ) => Promise<{ rows: Row[]; totals: Totals; footer?: ReportFooterRow[] }>;
  exportTo: (input: ExportReportInput) => Promise<ExportReportResult>;
}

export const salesByDayReport: ReportDefinition<SalesByDayRow, SalesByDayTotals> = {
  id: "sales-by-day",
  label: "Sales by day",
  columns: salesByDayColumns,
  load: (range): Promise<SalesByDayResult> => window.vendora.reports.salesByDay(range),
  exportTo: (input) => window.vendora.reports.exportSalesByDay(input),
};

export const grossProfitByProductReport: ReportDefinition<
  GrossProfitByProductRow,
  GrossProfitTotals
> = {
  id: "gross-profit-by-product",
  label: "Gross profit by product",
  columns: grossProfitByProductColumns,
  load: (range) => window.vendora.reports.grossProfitByProduct(range),
  exportTo: (input) => window.vendora.reports.exportGrossProfitByProduct(input),
};

export const grossProfitByCategoryReport: ReportDefinition<
  GrossProfitByCategoryRow,
  GrossProfitTotals
> = {
  id: "gross-profit-by-category",
  label: "Gross profit by category",
  columns: grossProfitByCategoryColumns,
  load: (range) => window.vendora.reports.grossProfitByCategory(range),
  exportTo: (input) => window.vendora.reports.exportGrossProfitByCategory(input),
};
