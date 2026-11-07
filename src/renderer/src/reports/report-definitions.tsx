import type { ComponentType } from "react";

import type { DiscountsReturnsVoidsResult } from "@shared/discounts-returns-voids";
import {
  salesByDayColumns,
  salesTaxSummaryColumns,
  type ExportReportInput,
  type ExportReportResult,
  type ReportRange,
  type SalesByDayResult,
  type SalesTaxSummaryResult,
} from "@shared/reports";
import { DiscountsReturnsVoidsBody } from "./discounts-returns-voids-view";
import { ReportTable } from "./report-table";

export interface ReportBodyProps<Result> {
  result: Result;
  busy: boolean;
  onOpenSale?: ((invoiceNo: string) => void) | undefined;
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

function SalesTaxSummaryBody({ result, busy }: ReportBodyProps<SalesTaxSummaryResult>) {
  return (
    <ReportTable
      label="Sales tax summary table"
      busy={busy}
      columns={salesTaxSummaryColumns}
      rows={result.rows}
      rowKey="rate"
      totals={result.totals}
    />
  );
}

export const salesTaxSummaryReport: ReportDefinition<SalesTaxSummaryResult> = {
  id: "sales-tax-summary",
  label: "Sales tax summary",
  emptyTitle: "No sales in this period",
  load: (range) => window.vendora.reports.salesTaxSummary(range),
  exportTo: (input) => window.vendora.reports.exportSalesTaxSummary(input),
  isEmpty: (result) => result.rows.length === 0,
  Body: SalesTaxSummaryBody,
};

export const discountsReturnsVoidsReport: ReportDefinition<DiscountsReturnsVoidsResult> = {
  id: "discounts-returns-voids",
  label: "Discounts, returns and voids",
  emptyTitle: "No discounts, returns or voids in this period",
  load: (range) => window.vendora.reports.discountsReturnsVoids(range),
  exportTo: (input) => window.vendora.reports.exportDiscountsReturnsVoids(input),
  isEmpty: ({ discounts, returns, voids }) =>
    discounts.billCount === 0 &&
    returns.lineCount === 0 &&
    voids.deletedLines.count === 0 &&
    voids.discardedBills.count === 0,
  Body: DiscountsReturnsVoidsBody,
};

export const reportDefinitions = [
  salesByDayReport,
  salesTaxSummaryReport,
  discountsReturnsVoidsReport,
] as const;
