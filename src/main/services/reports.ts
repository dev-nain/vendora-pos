import {
  exportReportFailedMessage,
  salesByDayColumns,
  salesByCashierColumns,
  salesByCategoryColumns,
  salesByHourColumns,
  salesByProductColumns,
  type ExportReportInput,
  type ExportReportResult,
  type ReportColumn,
  type ReportExportFormat,
  type ReportFooterRow,
  type ReportRange,
  type SalesByCashierResult,
  type SalesByCategoryResult,
  type SalesByDayResult,
  type SalesByHourResult,
  type SalesByProductResult,
} from "../../shared/reports";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import type { DocumentRenderer } from "../documents/document-window";
import { writeAtomic } from "../documents/write-atomic";
import { reportCsv } from "../reports/report-csv";
import { buildReportDocument } from "../reports/report-document";
import { readSalesByDay, readSalesByHour } from "../reports/sales-by-day";
import {
  readSalesByCashier,
  readSalesByCategory,
  readSalesByProduct,
} from "../reports/sales-by-line";
import { getReceiptSettings } from "../settings/store-settings";

interface ReportsDeps {
  database: VendoraDatabase;
  sessions: SessionStore;
  renderer: DocumentRenderer;
  chooseSavePath: (fileName: string, format: ReportExportFormat) => Promise<string | null>;
}

interface ExportTable<Row extends Record<string, string | number>> {
  title: string;
  fileStem: string;
  range: ReportRange;
  format: ReportExportFormat;
  columns: ReportColumn<Row>[];
  fileName?: string;
  reference?: string;
  read: (storeId: string) => {
    rows: Row[];
    totals: Record<string, number>;
    footer?: ReportFooterRow[];
  };
}

const exportFailed = {
  ok: false,
  reason: "failed",
  message: exportReportFailedMessage,
} as const;

const fileNameOf = ({
  fileStem,
  range,
  format,
}: Pick<ExportTable<never>, "fileStem" | "range" | "format">) =>
  range.from === range.to
    ? `${fileStem}-${range.from}.${format}`
    : `${fileStem}-${range.from}-to-${range.to}.${format}`;

export function createReportsService({
  database,
  sessions,
  renderer,
  chooseSavePath,
}: ReportsDeps) {
  function salesByDay(range: ReportRange): SalesByDayResult {
    const session = requireSession(sessions);
    return readSalesByDay(database, session.storeId, range);
  }

  function salesByHour(range: ReportRange): SalesByHourResult {
    const session = requireSession(sessions);
    return readSalesByHour(database, session.storeId, range);
  }

  function salesByProduct(range: ReportRange): SalesByProductResult {
    const session = requireSession(sessions);
    return readSalesByProduct(database, session.storeId, range);
  }

  function salesByCategory(range: ReportRange): SalesByCategoryResult {
    const session = requireSession(sessions);
    return readSalesByCategory(database, session.storeId, range);
  }

  function salesByCashier(range: ReportRange): SalesByCashierResult {
    const session = requireSession(sessions);
    return readSalesByCashier(database, session.storeId, range);
  }

  async function exportTable<Row extends Record<string, string | number>>(
    table: ExportTable<Row>,
  ): Promise<ExportReportResult> {
    requireSession(sessions);
    const path = await chooseSavePath(table.fileName ?? fileNameOf(table), table.format);
    if (path === null) return { ok: true, status: "cancelled" };
    const session = requireSession(sessions);
    const { rows, totals, footer } = table.read(session.storeId);
    try {
      const bytes =
        table.format === "csv"
          ? Buffer.from(
              reportCsv({ columns: table.columns, rows, totals, totalsLabel: "Total", footer }),
              "utf8",
            )
          : await renderer.toPdf(
              buildReportDocument({
                title: table.title,
                range: table.range,
                store: getReceiptSettings(database.db, session.storeId),
                columns: table.columns,
                rows,
                totals,
                footer,
                reference: table.reference,
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
    salesByHour,
    exportSalesByHour: ({ range, format }: ExportReportInput) =>
      exportTable({
        title: "Sales by hour",
        fileStem: "sales-by-hour",
        range,
        format,
        columns: salesByHourColumns,
        read: (storeId) => readSalesByHour(database, storeId, range),
      }),
    salesByProduct,
    exportSalesByProduct: ({ range, format }: ExportReportInput) =>
      exportTable({
        title: "Sales by product",
        fileStem: "sales-by-product",
        range,
        format,
        columns: salesByProductColumns,
        read: (storeId) => readSalesByProduct(database, storeId, range),
      }),
    salesByCategory,
    exportSalesByCategory: ({ range, format }: ExportReportInput) =>
      exportTable({
        title: "Sales by category",
        fileStem: "sales-by-category",
        range,
        format,
        columns: salesByCategoryColumns,
        read: (storeId) => readSalesByCategory(database, storeId, range),
      }),
    salesByCashier,
    exportSalesByCashier: ({ range, format }: ExportReportInput) =>
      exportTable({
        title: "Sales by cashier",
        fileStem: "sales-by-cashier",
        range,
        format,
        columns: salesByCashierColumns,
        read: (storeId) => readSalesByCashier(database, storeId, range),
      }),
    exportSalesByDay: ({ range, format }: ExportReportInput) =>
      exportTable({
        title: "Sales by day",
        fileStem: "sales-by-day",
        range,
        format,
        columns: salesByDayColumns,
        read: (storeId) => readSalesByDay(database, storeId, range),
      }),
  };
}

export type ReportsService = ReturnType<typeof createReportsService>;
