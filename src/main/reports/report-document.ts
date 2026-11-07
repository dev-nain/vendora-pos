import type { DocumentModel } from "../../shared/document";
import {
  formatRangeLabel,
  formatReportCell,
  isNumericColumn,
  type ReportCellValue,
  type ReportColumn,
  type ReportFooterRow,
  type ReportRange,
} from "../../shared/reports";
import type { ReceiptSettings } from "../../shared/settings";
import { buildStorePanel } from "../documents/store-panel";

interface Input<Row> {
  title: string;
  range: ReportRange;
  store: ReceiptSettings;
  columns: ReportColumn<Row>[];
  rows: Row[];
  totals: Record<string, number | null>;
  footer?: ReportFooterRow[];
}

function percentWidths<Row>(columns: ReportColumn<Row>[]): (string | undefined)[] {
  const pixels = columns.map((column) => Number.parseFloat(column.width ?? ""));
  if (pixels.some((value) => !Number.isFinite(value))) return columns.map(() => undefined);
  const sum = pixels.reduce((acc, value) => acc + value, 0);
  return pixels.map((value) => `${((value / sum) * 100).toFixed(1)}%`);
}

export function buildReportDocument<Row extends Record<string, ReportCellValue>>({
  title,
  range,
  store,
  columns,
  rows,
  totals,
  footer = [],
}: Input<Row>): DocumentModel {
  const storePanel = buildStorePanel(store);
  const widths = percentWidths(columns);

  return {
    title,
    reference: formatRangeLabel(range),
    panels: storePanel.lines.length > 0 ? [storePanel] : [],
    facts: [{ label: "Times", value: "Asia/Karachi" }],
    columns: columns.map((column, index) => {
      const width = widths[index];
      return {
        label: column.label,
        align: isNumericColumn(column) ? "right" : "left",
        ...(width ? { width } : {}),
      };
    }),
    rows: rows.map((row) =>
      columns.map((column) => ({ text: formatReportCell(column, row[column.key] ?? null) })),
    ),
    totals: [
      ...columns.slice(1).flatMap((column) => {
        const value = totals[column.key];
        return value === undefined
          ? []
          : [{ label: column.label, value: formatReportCell(column, value) }];
      }),
      ...footer.flatMap((entry) =>
        columns.slice(1).flatMap((column) => {
          const value = entry.values[column.key];
          return value === undefined
            ? []
            : [{ label: entry.label, value: formatReportCell(column, value) }];
        }),
      ),
    ],
    notes: null,
    landscape: true,
  };
}
