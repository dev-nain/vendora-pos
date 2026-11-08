import type { ReportSection } from "../../shared/discounts-returns-voids";
import {
  formatStoreTimeCsv,
  isNumericColumn,
  type ReportCellValue,
  type ReportColumn,
  type ReportFooterRow,
} from "../../shared/reports";
import { csvCell, formatMilli, formatPaisa } from "../services/catalog-csv";

const BOM = String.fromCodePoint(0xfeff);

interface Input<Row> {
  columns: ReportColumn<Row>[];
  rows: Row[];
  totals: Record<string, number | null> | null;
  totalsLabel: string;
  footer?: ReportFooterRow[];
}

const line = (cells: string[]) => `${cells.join(",")}\r\n`;

const signed = (value: number, format: (magnitude: number) => string): string =>
  value < 0 ? `-${format(-value)}` : format(value);

const percent = (bps: number): string => {
  const magnitude = Math.abs(bps);
  const hundredths = String(magnitude % 100).padStart(2, "0");
  return `${bps < 0 ? "-" : ""}${Math.trunc(magnitude / 100)}.${hundredths}%`;
};

function cell<Row>(column: ReportColumn<Row>, value: ReportCellValue): string {
  if (value === null) return "";
  switch (column.format) {
    case "text":
    case "invoice":
      return csvCell(String(value));
    case "time":
      return formatStoreTimeCsv(String(value));
    case "money":
      return signed(Number(value), formatPaisa);
    case "quantity":
      return signed(Number(value), formatMilli);
    case "percent":
      return percent(Number(value));
    case "count":
    case "day":
      return String(value);
  }
}

function block<Row extends Record<string, ReportCellValue>>({
  columns,
  rows,
  totals,
  totalsLabel,
  footer = [],
}: Input<Row>): string[] {
  const totalCells = columns.map((column, index) => {
    if (index === 0) return csvCell(totalsLabel);
    const value = totals?.[column.key];
    return value === undefined || !isNumericColumn(column) ? "" : cell(column, value);
  });
  const footerLines = footer.map((entry) =>
    line(
      columns.map((column, index) => {
        if (index === 0) return csvCell(entry.label);
        const value = entry.values[column.key];
        return value === undefined ? "" : cell(column, value);
      }),
    ),
  );
  return [
    line(columns.map((column) => csvCell(column.label))),
    ...rows.map((row) => line(columns.map((column) => cell(column, row[column.key] ?? null)))),
    ...(totals ? [line(totalCells)] : []),
    ...footerLines,
  ];
}

export function reportCsv<Row extends Record<string, ReportCellValue>>(input: Input<Row>): string {
  return [BOM, ...block(input)].join("");
}

export function reportCsvSections(sections: ReportSection[]): string {
  return [
    BOM,
    ...sections.flatMap((section, index) => [
      ...(index > 0 ? [line([])] : []),
      line([csvCell(section.title)]),
      ...block({ ...section, totalsLabel: "Total" }),
    ]),
  ].join("");
}
