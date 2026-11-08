import { sectionNote, type ReportSection } from "../../shared/discounts-returns-voids";
import type { DocumentModel, DocumentPair } from "../../shared/document";
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
import { storePanel as buildStorePanel } from "../documents/document-parts";

interface Input<Row> {
  title: string;
  reference: string;
  facts?: DocumentPair[];
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

function tableOf<Row extends Record<string, ReportCellValue>>(
  columns: ReportColumn<Row>[],
  rows: Row[],
  totals: Record<string, number | null> | null,
  footer: ReportFooterRow[] = [],
) {
  const widths = percentWidths(columns);
  return {
    columns: columns.map((column, index) => {
      const width = widths[index];
      return {
        label: column.label,
        align: isNumericColumn(column) ? ("right" as const) : ("left" as const),
        ...(width ? { width } : {}),
      };
    }),
    rows: rows.map((row) =>
      columns.map((column) => ({ text: formatReportCell(column, row[column.key] ?? null, row) })),
    ),
    totals: [
      ...columns.slice(1).flatMap((column) => {
        const value = totals?.[column.key];
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
  };
}

function frame(title: string, reference: string, store: ReceiptSettings, facts: DocumentPair[]) {
  const storePanel = buildStorePanel(store);
  return {
    title,
    reference,
    header: [],
    panels: storePanel.lines.length > 0 ? [storePanel] : [],
    facts: [{ label: "Times", value: "Asia/Karachi" }, ...facts],
    summaries: [],
    notes: null,
    footer: [],
    landscape: true,
  };
}

export function buildReportDocument<Row extends Record<string, ReportCellValue>>({
  title,
  reference,
  facts = [],
  store,
  columns,
  rows,
  totals,
  footer = [],
}: Input<Row>): DocumentModel {
  return { ...frame(title, reference, store, facts), ...tableOf(columns, rows, totals, footer) };
}

export function buildSectionedReportDocument({
  title,
  range,
  store,
  sections,
}: {
  title: string;
  range: ReportRange;
  store: ReceiptSettings;
  sections: ReportSection[];
}): DocumentModel {
  return {
    ...frame(title, formatRangeLabel(range), store, []),
    columns: [],
    rows: [],
    totals: [],
    sections: sections.map((section) => ({
      heading: section.title,
      ...tableOf(section.columns, section.rows, section.totals),
      note: sectionNote(section),
    })),
  };
}
