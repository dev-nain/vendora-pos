import {
  discountsReturnsVoidsSections,
  reportDetailLimit,
} from "../../shared/discounts-returns-voids";
import {
  exportReportFailedMessage,
  formatRangeLabel,
  formatStoreDateTime,
  grossProfitByCategoryColumns,
  grossProfitByProductColumns,
  type GrossProfitByCategoryResult,
  type GrossProfitByProductResult,
  salesByDayColumns,
  storeToday,
  salesTaxSummaryColumns,
  type ExportReportInput,
  type ExportReportResult,
  type ReportCellValue,
  type ReportColumn,
  type ReportExportFormat,
  type ReportFooterRow,
  type ReportRange,
  type SalesByDayResult,
  type SalesTaxSummaryResult,
} from "../../shared/reports";
import {
  lowStockReportColumns,
  negativeStockReportColumns,
  purchasesBySupplierColumns,
  stockMovementsColumns,
  stocktakeVarianceColumns,
  stockOnHandColumns,
  type ExportTodayReportInput,
  type StockMovementsExportInput,
  type StockMovementsReportInput,
  type StockMovementsReportResult,
  type LowStockReportResult,
  type PostedStocktakesResult,
  type StocktakeVarianceExportInput,
  type StocktakeVarianceReportInput,
  type StocktakeVarianceResult,
  type PurchasesBySupplierResult,
  type NegativeStockReportResult,
  type StockOnHandResult,
} from "../../shared/stock-reports";
import { formatQuantity } from "../../shared/quantity";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import type { DocumentRenderer } from "../documents/document-window";
import { writeAtomic } from "../documents/write-atomic";
import { readDiscountsReturnsVoids } from "../reports/discounts-returns-voids";
import { reportCsv, reportCsvSections } from "../reports/report-csv";
import { buildReportDocument, buildSectionedReportDocument } from "../reports/report-document";
import { readGrossProfitByCategory, readGrossProfitByProduct } from "../reports/gross-profit";
import { readSalesByDay } from "../reports/sales-by-day";
import { readPurchasesBySupplier } from "../reports/purchases-by-supplier";
import { readPostedStocktakes, readStocktakeVariance } from "../reports/stocktake-variance-report";
import { readStockMovements } from "../reports/stock-movements";
import { readLowStock, readNegativeStock, readStockOnHand } from "../reports/stock-position";
import { readSalesTaxSummary } from "../reports/sales-tax-summary";
import { getReceiptSettings } from "../settings/store-settings";

interface ReportsDeps {
  database: VendoraDatabase;
  sessions: SessionStore;
  renderer: DocumentRenderer;
  chooseSavePath: (fileName: string, format: ReportExportFormat) => Promise<string | null>;
  now?: () => Date;
}

interface ExportTable<Row extends Record<string, ReportCellValue>> {
  title: string;
  fileName: string;
  reference: () => string;
  format: ReportExportFormat;
  columns: ReportColumn<Row>[];
  read: (storeId: string) => {
    rows: Row[];
    totals: Record<string, number | null>;
    footer?: ReportFooterRow[];
    facts?: { label: string; value: string }[];
  };
}

const exportFailed = {
  ok: false,
  reason: "failed",
  message: exportReportFailedMessage,
} as const;

const fileNameOf = (fileStem: string, range: ReportRange, format: ReportExportFormat) =>
  range.from === range.to
    ? `${fileStem}-${range.from}.${format}`
    : `${fileStem}-${range.from}-to-${range.to}.${format}`;

export function createReportsService({
  database,
  sessions,
  renderer,
  chooseSavePath,
  now = () => new Date(),
}: ReportsDeps) {
  function salesByDay(range: ReportRange): SalesByDayResult {
    const session = requireSession(sessions);
    return readSalesByDay(database, session.storeId, range);
  }
  function stockOnHand(): StockOnHandResult {
    const session = requireSession(sessions);
    return readStockOnHand(database, session.storeId, now());
  }

  function lowStock(): LowStockReportResult {
    const session = requireSession(sessions);
    return readLowStock(database, session.storeId, now());
  }

  function negativeStock(): NegativeStockReportResult {
    const session = requireSession(sessions);
    return readNegativeStock(database, session.storeId, now());
  }

  function stockMovements(input: StockMovementsReportInput): StockMovementsReportResult {
    const session = requireSession(sessions);
    return readStockMovements(database, session.storeId, input);
  }

  function purchasesBySupplier(range: ReportRange): PurchasesBySupplierResult {
    const session = requireSession(sessions);
    return readPurchasesBySupplier(database, session.storeId, range);
  }

  function postedStocktakes(range: ReportRange): PostedStocktakesResult {
    const session = requireSession(sessions);
    return readPostedStocktakes(database, session.storeId, range);
  }

  function stocktakeVariance(input: StocktakeVarianceReportInput): StocktakeVarianceResult {
    const session = requireSession(sessions);
    return readStocktakeVariance(database, session.storeId, input);
  }

  const asOfReference = () => `As of ${formatStoreDateTime(now().toISOString())}`;
  const todayFileName = (stem: string, format: ReportExportFormat) =>
    `${stem}-${storeToday(now())}.${format}`;

  function grossProfitByProduct(range: ReportRange): GrossProfitByProductResult {
    const session = requireSession(sessions);
    return readGrossProfitByProduct(database, session.storeId, range);
  }

  function grossProfitByCategory(range: ReportRange): GrossProfitByCategoryResult {
    const session = requireSession(sessions);
    return readGrossProfitByCategory(database, session.storeId, range);
  }

  function salesTaxSummary(range: ReportRange): SalesTaxSummaryResult {
    const session = requireSession(sessions);
    return readSalesTaxSummary(database, session.storeId, range);
  }

  function discountsReturnsVoids(range: ReportRange) {
    const session = requireSession(sessions);
    return readDiscountsReturnsVoids(database, session.storeId, range, {
      limit: reportDetailLimit,
    });
  }

  async function exportFile(
    file: Pick<ExportTable<never>, "fileName" | "format">,
    render: (storeId: string) => Buffer | Promise<Buffer>,
  ): Promise<ExportReportResult> {
    requireSession(sessions);
    const path = await chooseSavePath(file.fileName, file.format);
    if (path === null) return { ok: true, status: "cancelled" };
    const session = requireSession(sessions);
    try {
      await writeAtomic(path, await render(session.storeId));
    } catch {
      return exportFailed;
    }
    return { ok: true, status: "saved", path };
  }

  function exportTable<Row extends Record<string, ReportCellValue>>(
    table: ExportTable<Row>,
  ): Promise<ExportReportResult> {
    return exportFile(table, (storeId) => {
      const { rows, totals, footer = [], facts } = table.read(storeId);
      return table.format === "csv"
        ? Buffer.from(
            reportCsv({ columns: table.columns, rows, totals, totalsLabel: "Total", footer }),
            "utf8",
          )
        : renderer.toPdf(
            buildReportDocument({
              title: table.title,
              reference: table.reference(),
              ...(facts ? { facts } : {}),
              store: getReceiptSettings(database.db, storeId),
              columns: table.columns,
              rows,
              totals,
              footer,
            }),
          );
    });
  }

  function exportDiscountsReturnsVoids({ range, format }: ExportReportInput) {
    const fileName = fileNameOf("discounts-returns-voids", range, format);
    return exportFile({ fileName, format }, (storeId) => {
      const sections = discountsReturnsVoidsSections(
        readDiscountsReturnsVoids(database, storeId, range, {
          limit: format === "csv" ? null : reportDetailLimit,
        }),
      );
      return format === "csv"
        ? Buffer.from(reportCsvSections(sections), "utf8")
        : renderer.toPdf(
            buildSectionedReportDocument({
              title: "Discounts, returns and voids",
              range,
              store: getReceiptSettings(database.db, storeId),
              sections,
            }),
          );
    });
  }

  return {
    salesByDay,
    grossProfitByProduct,
    grossProfitByCategory,
    exportGrossProfitByProduct: ({ range, format }: ExportReportInput) =>
      exportTable({
        title: "Gross profit by product",
        fileName: fileNameOf("gross-profit-by-product", range, format),
        reference: () => formatRangeLabel(range),
        format,
        columns: grossProfitByProductColumns,
        read: (storeId) => readGrossProfitByProduct(database, storeId, range),
      }),
    exportGrossProfitByCategory: ({ range, format }: ExportReportInput) =>
      exportTable({
        title: "Gross profit by category",
        fileName: fileNameOf("gross-profit-by-category", range, format),
        reference: () => formatRangeLabel(range),
        format,
        columns: grossProfitByCategoryColumns,
        read: (storeId) => readGrossProfitByCategory(database, storeId, range),
      }),
    discountsReturnsVoids,
    salesTaxSummary,
    exportDiscountsReturnsVoids,
    exportSalesByDay: ({ range, format }: ExportReportInput) =>
      exportTable({
        title: "Sales by day",
        fileName: fileNameOf("sales-by-day", range, format),
        reference: () => formatRangeLabel(range),
        format,
        columns: salesByDayColumns,
        read: (storeId) => readSalesByDay(database, storeId, range),
      }),
    exportSalesTaxSummary: ({ range, format }: ExportReportInput) =>
      exportTable({
        title: "Sales tax summary",
        fileName: fileNameOf("sales-tax-summary", range, format),
        reference: () => formatRangeLabel(range),
        format,
        columns: salesTaxSummaryColumns,
        read: (storeId) => readSalesTaxSummary(database, storeId, range),
      }),
    stockOnHand,
    lowStock,
    negativeStock,
    exportStockOnHand: ({ format }: ExportTodayReportInput) =>
      exportTable({
        title: "Stock on hand and valuation",
        fileName: todayFileName("stock-on-hand", format),
        reference: asOfReference,
        format,
        columns: stockOnHandColumns,
        read: (storeId) => ({
          ...readStockOnHand(database, storeId, now()),
          facts: [{ label: "Valued at", value: "Current average cost" }],
        }),
      }),
    stockMovements,
    exportStockMovements: ({ productId, range, format }: StockMovementsExportInput) => {
      let productName = "";
      return exportTable({
        title: "Stock movements",
        fileName: fileNameOf("stock-movements", range, format),
        reference: () =>
          productName ? `${productName} · ${formatRangeLabel(range)}` : formatRangeLabel(range),
        format,
        columns: stockMovementsColumns,
        read: (storeId) => {
          const result = readStockMovements(database, storeId, { productId, range });
          productName = result.product?.nameEn ?? "";
          return {
            ...result,
            facts: result.product
              ? [
                  {
                    label: "Opening balance",
                    value: formatQuantity(result.openingMilli, result.product.unit),
                  },
                  {
                    label: "Closing balance",
                    value: formatQuantity(result.closingMilli, result.product.unit),
                  },
                ]
              : [],
          };
        },
      });
    },
    purchasesBySupplier,
    exportPurchasesBySupplier: ({ range, format }: ExportReportInput) =>
      exportTable({
        title: "Purchases by supplier",
        fileName: fileNameOf("purchases-by-supplier", range, format),
        reference: () => formatRangeLabel(range),
        format,
        columns: purchasesBySupplierColumns,
        read: (storeId) => readPurchasesBySupplier(database, storeId, range),
      }),
    postedStocktakes,
    stocktakeVariance,
    exportStocktakeVariance: ({ range, stocktakeId, format }: StocktakeVarianceExportInput) => {
      let countLabel = "";
      return exportTable({
        title: "Stocktake variance",
        fileName: fileNameOf("stocktake-variance", range, format),
        reference: () =>
          countLabel ? `${formatRangeLabel(range)} · ${countLabel}` : formatRangeLabel(range),
        format,
        columns: stocktakeVarianceColumns,
        read: (storeId) => {
          const picked = stocktakeId
            ? readPostedStocktakes(database, storeId, range).items.find(
                (item) => item.id === stocktakeId,
              )
            : undefined;
          countLabel = picked ? `${formatStoreDateTime(picked.postedAt)} · ${picked.label}` : "";
          return readStocktakeVariance(database, storeId, { range, stocktakeId });
        },
      });
    },
    exportLowStock: ({ format }: ExportTodayReportInput) =>
      exportTable({
        title: "Low stock",
        fileName: todayFileName("low-stock", format),
        reference: asOfReference,
        format,
        columns: lowStockReportColumns,
        read: (storeId) => readLowStock(database, storeId, now()),
      }),
    exportNegativeStock: ({ format }: ExportTodayReportInput) =>
      exportTable({
        title: "Negative stock",
        fileName: todayFileName("negative-stock", format),
        reference: asOfReference,
        format,
        columns: negativeStockReportColumns,
        read: (storeId) => readNegativeStock(database, storeId, now()),
      }),
  };
}

export type ReportsService = ReturnType<typeof createReportsService>;
