import {
  exportReportFailedMessage,
  formatRangeLabel,
  formatStoreDateTime,
  salesByDayColumns,
  storeToday,
  type ExportReportInput,
  type ExportReportResult,
  type ReportColumn,
  type ReportExportFormat,
  type ReportRange,
  type SalesByDayResult,
} from "../../shared/reports";
import {
  lowStockReportColumns,
  negativeStockReportColumns,
  purchasesBySupplierColumns,
  stockMovementsColumns,
  stockOnHandColumns,
  type ExportTodayReportInput,
  type StockMovementsExportInput,
  type StockMovementsReportInput,
  type StockMovementsReportResult,
  type LowStockReportResult,
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
import { reportCsv } from "../reports/report-csv";
import { buildReportDocument } from "../reports/report-document";
import { readSalesByDay } from "../reports/sales-by-day";
import { readPurchasesBySupplier } from "../reports/purchases-by-supplier";
import { readStockMovements } from "../reports/stock-movements";
import { readLowStock, readNegativeStock, readStockOnHand } from "../reports/stock-position";
import { getReceiptSettings } from "../settings/store-settings";

interface ReportsDeps {
  database: VendoraDatabase;
  sessions: SessionStore;
  renderer: DocumentRenderer;
  chooseSavePath: (fileName: string, format: ReportExportFormat) => Promise<string | null>;
  now?: () => Date;
}

interface ExportTable<Row extends Record<string, string | number>> {
  title: string;
  fileName: string;
  reference: () => string;
  format: ReportExportFormat;
  columns: ReportColumn<Row>[];
  read: (storeId: string) => {
    rows: Row[];
    totals: Record<string, number>;
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

  const asOfReference = () => `As of ${formatStoreDateTime(now().toISOString())}`;
  const todayFileName = (stem: string, format: ReportExportFormat) =>
    `${stem}-${storeToday(now())}.${format}`;

  async function exportTable<Row extends Record<string, string | number>>(
    table: ExportTable<Row>,
  ): Promise<ExportReportResult> {
    requireSession(sessions);
    const path = await chooseSavePath(table.fileName, table.format);
    if (path === null) return { ok: true, status: "cancelled" };
    const session = requireSession(sessions);
    const { rows, totals, facts } = table.read(session.storeId);
    try {
      const bytes =
        table.format === "csv"
          ? Buffer.from(
              reportCsv({ columns: table.columns, rows, totals, totalsLabel: "Total" }),
              "utf8",
            )
          : await renderer.toPdf(
              buildReportDocument({
                title: table.title,
                reference: table.reference(),
                ...(facts ? { facts } : {}),
                store: getReceiptSettings(database.db, session.storeId),
                columns: table.columns,
                rows,
                totals,
              }),
            );
      await writeAtomic(path, bytes);
    } catch {
      return exportFailed;
    }
    return { ok: true, status: "saved", path };
  }

  return {
    salesByDay,
    exportSalesByDay: ({ range, format }: ExportReportInput) =>
      exportTable({
        title: "Sales by day",
        fileName: fileNameOf("sales-by-day", range, format),
        reference: () => formatRangeLabel(range),
        format,
        columns: salesByDayColumns,
        read: (storeId) => readSalesByDay(database, storeId, range),
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
