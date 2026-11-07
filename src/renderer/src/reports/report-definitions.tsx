import type { ComponentType } from "react";

import {
  salesByDayColumns,
  type ExportReportInput,
  type ExportReportResult,
  type ReportRange,
  type SalesByDayResult,
} from "@shared/reports";
import { ReportTable } from "./report-table";

export interface ReportBodyProps<Result> {
  result: Result;
  busy: boolean;
}

export interface ReportDefinition<Result> {
  id: string;
  label: string;
  emptyTitle: string;
  load: (range: ReportRange) => Promise<Result>;
  exportTo: (input: ExportReportInput) => Promise<ExportReportResult>;
  isEmpty: (result: Result) => boolean;
  Body: ComponentType<ReportBodyProps<Result>>;
}

function SalesByDayBody({ result, busy }: ReportBodyProps<SalesByDayResult>) {
  return (
    <ReportTable
      label="Sales by day table"
      busy={busy}
      columns={salesByDayColumns}
      rows={result.rows}
      rowKey="day"
      totals={result.totals}
    />
  );
}

export const salesByDayReport: ReportDefinition<SalesByDayResult> = {
  id: "sales-by-day",
  label: "Sales by day",
  emptyTitle: "No sales in this period",
  load: (range) => window.vendora.reports.salesByDay(range),
  exportTo: (input) => window.vendora.reports.exportSalesByDay(input),
  isEmpty: (result) => result.rows.length === 0,
  Body: SalesByDayBody,
};

export const reportDefinitions = [salesByDayReport] as const;
