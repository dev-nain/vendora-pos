import type { ReportSection } from "../../shared/discounts-returns-voids";
import { formatStoreTimeCsv, isNumericColumn, type ReportColumn } from "../../shared/reports";
import { csvCell, formatMilli, formatPaisa } from "../services/catalog-csv";

type CellValue = string | number;

const BOM = String.fromCodePoint(0xfeff);

interface Input<Row> {
  columns: ReportColumn<Row>[];
  rows: Row[];
  totals: Record<string, number> | null;
  totalsLabel: string;
}

const line = (cells: string[]) => `${cells.join(",")}\r\n`;

const signed = (value: number, format: (magnitude: number) => string): string =>
  value < 0 ? `-${format(-value)}` : format(value);

function cell<Row>(column: ReportColumn<Row>, value: CellValue): string {
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
    case "count":
    case "day":
      return String(value);
  }
}

function block<Row extends Record<string, CellValue>>({
  columns,
  rows,
  totals,
  totalsLabel,
}: Input<Row>): string[] {
  const totalCells = columns.map((column, index) => {
    if (index === 0) return csvCell(totalsLabel);
    const value = totals?.[column.key];
    return value === undefined || !isNumericColumn(column) ? "" : cell(column, value);
  });
  return [
    line(columns.map((column) => csvCell(column.label))),
    ...rows.map((row) => line(columns.map((column) => cell(column, row[column.key] ?? "")))),
    ...(totals ? [line(totalCells)] : []),
  ];
}

export function reportCsv<Row extends Record<string, CellValue>>(input: Input<Row>): string {
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
