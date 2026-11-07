import { isNumericColumn, type ReportColumn, type ReportFooterRow } from "../../shared/reports";
import { csvCell, formatMilli, formatPaisa } from "../services/catalog-csv";

type CellValue = string | number;

const BOM = String.fromCodePoint(0xfeff);

interface Input<Row> {
  columns: ReportColumn<Row>[];
  rows: Row[];
  totals: Record<string, number>;
  totalsLabel: string;
  footer?: ReportFooterRow[] | undefined;
}

const line = (cells: string[]) => `${cells.join(",")}\r\n`;

const signed = (value: number, format: (magnitude: number) => string): string =>
  value < 0 ? `-${format(-value)}` : format(value);

function cell<Row>(column: ReportColumn<Row>, value: CellValue): string {
  switch (column.format) {
    case "text":
      return csvCell(String(value));
    case "money":
      return signed(Number(value), formatPaisa);
    case "quantity":
      return signed(Number(value), formatMilli);
    case "count":
    case "day":
      return String(value);
  }
}

export function reportCsv<Row extends Record<string, CellValue>>({
  columns,
  rows,
  totals,
  totalsLabel,
  footer = [],
}: Input<Row>): string {
  const totalCells = columns.map((column, index) => {
    if (index === 0) return csvCell(totalsLabel);
    const value = totals[column.key];
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
    BOM,
    line(columns.map((column) => csvCell(column.label))),
    ...rows.map((row) => line(columns.map((column) => cell(column, row[column.key] ?? "")))),
    line(totalCells),
    ...footerLines,
  ].join("");
}
