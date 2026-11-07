import type { DocumentModel } from "../../shared/document";
import { formatReportCell, isNumericColumn, type ReportColumn } from "../../shared/reports";
import type { ReceiptSettings } from "../../shared/settings";
import { buildStorePanel } from "../documents/store-panel";

type CellValue = string | number;

interface Input<Row> {
  title: string;
  reference: string;
  facts?: { label: string; value: string }[];
  store: ReceiptSettings;
  columns: ReportColumn<Row>[];
  rows: Row[];
  totals: Record<string, number>;
}

function percentWidths<Row>(columns: ReportColumn<Row>[]): (string | undefined)[] {
  const pixels = columns.map((column) => Number.parseFloat(column.width ?? ""));
  if (pixels.some((value) => !Number.isFinite(value))) return columns.map(() => undefined);
  const sum = pixels.reduce((acc, value) => acc + value, 0);
  return pixels.map((value) => `${((value / sum) * 100).toFixed(1)}%`);
}

export function buildReportDocument<Row extends Record<string, CellValue>>({
  title,
  reference,
  facts = [],
  store,
  columns,
  rows,
  totals,
}: Input<Row>): DocumentModel {
  const storePanel = buildStorePanel(store);
  const widths = percentWidths(columns);

  return {
    title,
    reference,
    panels: storePanel.lines.length > 0 ? [storePanel] : [],
    facts: [{ label: "Times", value: "Asia/Karachi" }, ...facts],
    columns: columns.map((column, index) => {
      const width = widths[index];
      return {
        label: column.label,
        align: isNumericColumn(column) ? "right" : "left",
        ...(width ? { width } : {}),
      };
    }),
    rows: rows.map((row) =>
      columns.map((column) => ({ text: formatReportCell(column, row[column.key] ?? "", row) })),
    ),
    totals: columns.slice(1).flatMap((column) => {
      const value = totals[column.key];
      return value === undefined
        ? []
        : [{ label: column.label, value: formatReportCell(column, value) }];
    }),
    notes: null,
    landscape: true,
  };
}
