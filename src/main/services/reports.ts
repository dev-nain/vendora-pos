import {
  discountsReturnsVoidsSections,
  reportDetailLimit,
} from "../../shared/discounts-returns-voids";
import {
  exportReportFailedMessage,
  salesByDayColumns,
  type ExportReportInput,
  type ExportReportResult,
  type ReportColumn,
  type ReportExportFormat,
  type ReportRange,
  type SalesByDayResult,
} from "../../shared/reports";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import type { DocumentRenderer } from "../documents/document-window";
import { writeAtomic } from "../documents/write-atomic";
import { readDiscountsReturnsVoids } from "../reports/discounts-returns-voids";
import { reportCsv, reportCsvSections } from "../reports/report-csv";
import { buildReportDocument, buildSectionedReportDocument } from "../reports/report-document";
import { readSalesByDay } from "../reports/sales-by-day";
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
  read: (storeId: string) => { rows: Row[]; totals: Record<string, number> };
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

  function discountsReturnsVoids(range: ReportRange) {
    const session = requireSession(sessions);
    return readDiscountsReturnsVoids(database, session.storeId, range, {
      limit: reportDetailLimit,
    });
  }

  async function exportFile(
    file: Pick<ExportTable<never>, "fileStem" | "range" | "format">,
    render: (storeId: string) => Buffer | Promise<Buffer>,
  ): Promise<ExportReportResult> {
    requireSession(sessions);
    const path = await chooseSavePath(fileNameOf(file), file.format);
    if (path === null) return { ok: true, status: "cancelled" };
    const session = requireSession(sessions);
    try {
      await writeAtomic(path, await render(session.storeId));
    } catch {
      return exportFailed;
    }
    return { ok: true, status: "saved", path };
  }

  function exportTable<Row extends Record<string, string | number>>(
    table: ExportTable<Row>,
  ): Promise<ExportReportResult> {
    return exportFile(table, (storeId) => {
      const { rows, totals } = table.read(storeId);
      return table.format === "csv"
        ? Buffer.from(
            reportCsv({ columns: table.columns, rows, totals, totalsLabel: "Total" }),
            "utf8",
          )
        : renderer.toPdf(
            buildReportDocument({
              title: table.title,
              range: table.range,
              store: getReceiptSettings(database.db, storeId),
              columns: table.columns,
              rows,
              totals,
            }),
          );
    });
  }

  function exportDiscountsReturnsVoids({ range, format }: ExportReportInput) {
    return exportFile({ fileStem: "discounts-returns-voids", range, format }, (storeId) => {
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
    discountsReturnsVoids,
    exportDiscountsReturnsVoids,
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
