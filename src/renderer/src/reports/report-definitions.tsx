import type { ComponentType } from "react";

import type { DiscountsReturnsVoidsResult } from "@shared/discounts-returns-voids";
import {
  grossProfitByCategoryColumns,
  grossProfitByProductColumns,
  salesByDayColumns,
  salesTaxSummaryColumns,
  type ExportReportResult,
  type GrossProfitByCategoryResult,
  type GrossProfitByProductResult,
  type ReportExportFormat,
  type ReportRange,
  type SalesByDayResult,
  type SalesTaxSummaryResult,
} from "@shared/reports";
import { formatRupees, signedRupees } from "@shared/money";
import {
  lowStockReportColumns,
  negativeStockReportColumns,
  purchasesBySupplierColumns,
  stockMovementsColumns,
  stockOnHandColumns,
  stocktakeVarianceColumns,
  type LowStockReportResult,
  type NegativeStockReportResult,
  type PurchasesBySupplierResult,
  type StockMovementsReportResult,
  type StockOnHandResult,
  type StocktakeVarianceResult,
} from "@shared/stock-reports";
import { onHandText } from "../inventory/stock-format";
import { formatDateTime } from "../lib/date-time";
import { DiscountsReturnsVoidsBody } from "./discounts-returns-voids-view";
import { PagedReportTable } from "./paged-report-table";
import { ReportTable } from "./report-table";

export interface ReportBodyProps<Result> {
  result: Result;
  busy: boolean;
  onOpenSale?: ((invoiceNo: string) => void) | undefined;
}

export interface ReportQuery {
  range: ReportRange;
  productId: string | null;
  stocktakeId: string | null;
}

export interface ReportDefinition<Result> {
  id: string;
  label: string;
  emptyTitle: string;
  emptyHint?: string;
  period?: "range" | "today";
  subject?: "none" | "product" | "stocktake";
  waitingText?: string;
  load: (query: ReportQuery) => Promise<Result> | null;
  exportTo: (query: ReportQuery, format: ReportExportFormat) => Promise<ExportReportResult> | null;
  isEmpty: (result: Result) => boolean;
  caption?: (result: Result) => string | null;
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
  load: ({ range }) => window.vendora.reports.salesByDay(range),
  exportTo: ({ range }, format) => window.vendora.reports.exportSalesByDay({ range, format }),
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
  load: ({ range }) => window.vendora.reports.salesTaxSummary(range),
  exportTo: ({ range }, format) => window.vendora.reports.exportSalesTaxSummary({ range, format }),
  isEmpty: (result) => result.rows.length === 0,
  Body: SalesTaxSummaryBody,
};

function GrossProfitByProductBody({ result, busy }: ReportBodyProps<GrossProfitByProductResult>) {
  return (
    <ReportTable
      label="Gross profit by product table"
      busy={busy}
      columns={grossProfitByProductColumns}
      rows={result.rows}
      totals={result.totals}
      footer={result.footer}
    />
  );
}

function GrossProfitByCategoryBody({ result, busy }: ReportBodyProps<GrossProfitByCategoryResult>) {
  return (
    <ReportTable
      label="Gross profit by category table"
      busy={busy}
      columns={grossProfitByCategoryColumns}
      rows={result.rows}
      totals={result.totals}
      footer={result.footer}
    />
  );
}

export const grossProfitByProductReport: ReportDefinition<GrossProfitByProductResult> = {
  id: "gross-profit-by-product",
  label: "Gross profit by product",
  emptyTitle: "No sales in this period",
  load: ({ range }) => window.vendora.reports.grossProfitByProduct(range),
  exportTo: ({ range }, format) =>
    window.vendora.reports.exportGrossProfitByProduct({ range, format }),
  isEmpty: (result) => result.rows.length === 0,
  Body: GrossProfitByProductBody,
};

export const grossProfitByCategoryReport: ReportDefinition<GrossProfitByCategoryResult> = {
  id: "gross-profit-by-category",
  label: "Gross profit by category",
  emptyTitle: "No sales in this period",
  load: ({ range }) => window.vendora.reports.grossProfitByCategory(range),
  exportTo: ({ range }, format) =>
    window.vendora.reports.exportGrossProfitByCategory({ range, format }),
  isEmpty: (result) => result.rows.length === 0,
  Body: GrossProfitByCategoryBody,
};

export const discountsReturnsVoidsReport: ReportDefinition<DiscountsReturnsVoidsResult> = {
  id: "discounts-returns-voids",
  label: "Discounts, returns and voids",
  emptyTitle: "No discounts, returns or voids in this period",
  load: ({ range }) => window.vendora.reports.discountsReturnsVoids(range),
  exportTo: ({ range }, format) =>
    window.vendora.reports.exportDiscountsReturnsVoids({ range, format }),
  isEmpty: ({ discounts, returns, voids }) =>
    discounts.billCount === 0 &&
    returns.lineCount === 0 &&
    voids.deletedLines.count === 0 &&
    voids.discardedBills.count === 0,
  Body: DiscountsReturnsVoidsBody,
};

const reports = () => window.vendora.reports;

const asOfCaption = (asOf: string, suffix = "") => `As of ${formatDateTime(asOf)}${suffix}`;

const pagedBody =
  <
    Result extends { rows: Row[]; totals: Record<string, number | null> },
    Row extends Record<string, string | number>,
  >(
    label: string,
    columns: Parameters<typeof PagedReportTable<Row>>[0]["columns"],
  ) =>
  ({ result, busy }: ReportBodyProps<Result>) => (
    <PagedReportTable
      label={label}
      busy={busy}
      columns={columns}
      rows={result.rows}
      totals={result.totals}
    />
  );

const noRows = (result: { rows: unknown[] }) => result.rows.length === 0;

export const stockOnHandReport: ReportDefinition<StockOnHandResult> = {
  id: "stock-on-hand",
  label: "Stock on hand and valuation",
  emptyTitle: "No products yet",
  emptyHint: "Add products to see stock on hand.",
  period: "today",
  load: () => reports().stockOnHand(),
  exportTo: (_query, format) => reports().exportStockOnHand({ format }),
  isEmpty: noRows,
  caption: ({ asOf }) => asOfCaption(asOf, " · valued at current average cost"),
  Body: pagedBody("Stock on hand and valuation table", stockOnHandColumns),
};

export const lowStockReport: ReportDefinition<LowStockReportResult> = {
  id: "low-stock",
  label: "Low stock",
  emptyTitle: "Nothing is low on stock",
  emptyHint: "Products show here when on hand falls to their low-stock level.",
  period: "today",
  load: () => reports().lowStock(),
  exportTo: (_query, format) => reports().exportLowStock({ format }),
  isEmpty: noRows,
  caption: ({ asOf }) => asOfCaption(asOf),
  Body: pagedBody("Low stock table", lowStockReportColumns),
};

export const negativeStockReport: ReportDefinition<NegativeStockReportResult> = {
  id: "negative-stock",
  label: "Negative stock",
  emptyTitle: "No products below zero",
  emptyHint: "Products show here when sales take stock below zero.",
  period: "today",
  load: () => reports().negativeStock(),
  exportTo: (_query, format) => reports().exportNegativeStock({ format }),
  isEmpty: noRows,
  caption: ({ asOf }) => asOfCaption(asOf),
  Body: pagedBody("Negative stock table", negativeStockReportColumns),
};

export const stockMovementsReport: ReportDefinition<StockMovementsReportResult> = {
  id: "stock-movements",
  label: "Stock movements",
  emptyTitle: "No movements in this period",
  subject: "product",
  waitingText: "Pick a product to see its movements.",
  load: ({ range, productId }) =>
    productId === null ? null : reports().stockMovements({ productId, range }),
  exportTo: ({ range, productId }, format) =>
    productId === null ? null : reports().exportStockMovements({ productId, range, format }),
  isEmpty: noRows,
  caption: ({ product, openingMilli, closingMilli }) =>
    product
      ? `Opening balance ${onHandText(openingMilli, product.unit)} · Closing balance ${onHandText(closingMilli, product.unit)}`
      : null,
  Body: pagedBody("Stock movements table", stockMovementsColumns),
};

export const purchasesBySupplierReport: ReportDefinition<PurchasesBySupplierResult> = {
  id: "purchases-by-supplier",
  label: "Purchases by supplier",
  emptyTitle: "No purchases in this period",
  load: ({ range }) => reports().purchasesBySupplier(range),
  exportTo: ({ range }, format) => reports().exportPurchasesBySupplier({ range, format }),
  isEmpty: noRows,
  Body: pagedBody("Purchases by supplier table", purchasesBySupplierColumns),
};

export const stocktakeVarianceReport: ReportDefinition<StocktakeVarianceResult> = {
  id: "stocktake-variance",
  label: "Stocktake variance",
  emptyTitle: "No stocktake variance in this period",
  emptyHint: "Posted counts with a difference show here.",
  subject: "stocktake",
  load: ({ range, stocktakeId }) => reports().stocktakeVariance({ range, stocktakeId }),
  exportTo: ({ range, stocktakeId }, format) =>
    reports().exportStocktakeVariance({ range, stocktakeId, format }),
  isEmpty: noRows,
  caption: ({ countCount, shortValuePaisa, surplusValuePaisa }) =>
    `Short ${signedRupees(shortValuePaisa)} · Over +${formatRupees(surplusValuePaisa)} · ${countCount} ${countCount === 1 ? "count" : "counts"}`,
  Body: pagedBody("Stocktake variance table", stocktakeVarianceColumns),
};
