import { formatRupees, signedRupees } from "@shared/money";
import {
  salesByDayColumns,
  type ExportReportResult,
  type ReportColumn,
  type ReportExportFormat,
  type ReportRange,
  type SalesByDayRow,
  type SalesByDayTotals,
} from "@shared/reports";
import {
  lowStockReportColumns,
  negativeStockReportColumns,
  purchasesBySupplierColumns,
  stockMovementsColumns,
  stockOnHandColumns,
  stocktakeVarianceColumns,
  type LowStockReportRow,
  type NegativeStockReportRow,
  type PurchasesBySupplierRow,
  type PurchasesBySupplierTotals,
  type StockMovementReportRow,
  type StockOnHandRow,
  type StocktakeVarianceRow,
} from "@shared/stock-reports";
import { formatDateTime } from "../lib/date-time";
import { onHandText } from "../inventory/stock-format";

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

const reports = () => window.vendora.reports;

const asOfCaption = (asOf: string, suffix = "") => `As of ${formatDateTime(asOf)}${suffix}`;

export const salesByDayReport: ReportDefinition<SalesByDayRow, SalesByDayTotals> = {
  id: "sales-by-day",
  label: "Sales by day",
  columns: salesByDayColumns,
  period: "range",
  subject: "none",
  emptyTitle: "No sales in this period",
  emptyHint: "Try another date range.",
  load: ({ range }) => reports().salesByDay(range),
  exportTo: ({ range }, format) => reports().exportSalesByDay({ range, format }),
};

export const stockOnHandReport: ReportDefinition<StockOnHandRow, { stockValuePaisa: number }> = {
  id: "stock-on-hand",
  label: "Stock on hand and valuation",
  columns: stockOnHandColumns,
  period: "today",
  subject: "none",
  emptyTitle: "No products yet",
  emptyHint: "Add products to see stock on hand.",
  load: () =>
    reports()
      .stockOnHand()
      .then(({ asOf, rows, totals }) => ({
        rows,
        totals,
        caption: asOfCaption(asOf, " · valued at current average cost"),
      })),
  exportTo: (_query, format) => reports().exportStockOnHand({ format }),
};

export const lowStockReport: ReportDefinition<LowStockReportRow, Record<string, never>> = {
  id: "low-stock",
  label: "Low stock",
  columns: lowStockReportColumns,
  period: "today",
  subject: "none",
  emptyTitle: "Nothing is low on stock",
  emptyHint: "Products show here when on hand falls to their low-stock level.",
  load: () =>
    reports()
      .lowStock()
      .then(({ asOf, rows, totals }) => ({ rows, totals, caption: asOfCaption(asOf) })),
  exportTo: (_query, format) => reports().exportLowStock({ format }),
};

export const negativeStockReport: ReportDefinition<
  NegativeStockReportRow,
  { stockValuePaisa: number }
> = {
  id: "negative-stock",
  label: "Negative stock",
  columns: negativeStockReportColumns,
  period: "today",
  subject: "none",
  emptyTitle: "No products below zero",
  emptyHint: "Products show here when sales take stock below zero.",
  load: () =>
    reports()
      .negativeStock()
      .then(({ asOf, rows, totals }) => ({ rows, totals, caption: asOfCaption(asOf) })),
  exportTo: (_query, format) => reports().exportNegativeStock({ format }),
};

export const stockMovementsReport: ReportDefinition<
  StockMovementReportRow,
  { valuePaisa: number }
> = {
  id: "stock-movements",
  label: "Stock movements",
  columns: stockMovementsColumns,
  period: "range",
  subject: "product",
  emptyTitle: "No movements in this period",
  emptyHint: "Try another date range.",
  waitingText: "Pick a product to see its movements.",
  load: ({ range, productId }) =>
    productId === null
      ? null
      : reports()
          .stockMovements({ productId, range })
          .then(({ product, openingMilli, closingMilli, rows, totals }) => ({
            rows,
            totals,
            caption: product
              ? `Opening balance ${onHandText(openingMilli, product.unit)} · Closing balance ${onHandText(closingMilli, product.unit)}`
              : null,
          })),
  exportTo: ({ range, productId }, format) =>
    productId === null ? null : reports().exportStockMovements({ productId, range, format }),
};

export const purchasesBySupplierReport: ReportDefinition<
  PurchasesBySupplierRow,
  PurchasesBySupplierTotals
> = {
  id: "purchases-by-supplier",
  label: "Purchases by supplier",
  columns: purchasesBySupplierColumns,
  period: "range",
  subject: "none",
  emptyTitle: "No purchases in this period",
  emptyHint: "Try another date range.",
  load: ({ range }) => reports().purchasesBySupplier(range),
  exportTo: ({ range }, format) => reports().exportPurchasesBySupplier({ range, format }),
};

export const stocktakeVarianceReport: ReportDefinition<
  StocktakeVarianceRow,
  { valuePaisa: number }
> = {
  id: "stocktake-variance",
  label: "Stocktake variance",
  columns: stocktakeVarianceColumns,
  period: "range",
  subject: "stocktake",
  emptyTitle: "No stocktake variance in this period",
  emptyHint: "Posted counts with a difference show here.",
  load: ({ range, stocktakeId }) =>
    reports()
      .stocktakeVariance({ range, stocktakeId })
      .then(({ countCount, shortValuePaisa, surplusValuePaisa, rows, totals }) => ({
        rows,
        totals,
        caption: `Short ${signedRupees(shortValuePaisa)} · Over +${formatRupees(surplusValuePaisa)} · ${countCount} ${countCount === 1 ? "count" : "counts"}`,
      })),
  exportTo: ({ range, stocktakeId }, format) =>
    reports().exportStocktakeVariance({ range, stocktakeId, format }),
};
