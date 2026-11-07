import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import {
  formatReportCell,
  isNumericColumn,
  type ReportCellValue,
  type ReportColumn,
  type ReportFooterRow,
} from "@shared/reports";
import { negativeClass } from "../inventory/stock-format";

interface ReportTableProps<Row extends Record<string, ReportCellValue>> {
  label: string;
  busy: boolean;
  columns: ReportColumn<Row>[];
  rows: Row[];
  totals: Record<string, number | null>;
  footer: ReportFooterRow[];
}

const cellClass = (column: { format: string }, value: ReportCellValue) =>
  `px-200 whitespace-nowrap ${
    column.format === "day" || column.format === "text" ? "" : "text-right tabular-nums"
  } ${typeof value === "number" ? negativeClass(value) : ""}`;

export function ReportTable<Row extends Record<string, ReportCellValue>>({
  label,
  busy,
  columns,
  rows,
  totals,
  footer,
}: ReportTableProps<Row>) {
  return (
    <Table
      className="table-fixed"
      container={{
        className: "min-h-0 shrink overflow-auto",
        tabIndex: 0,
        role: "region",
        "aria-label": label,
        "aria-busy": busy,
      }}
    >
      <colgroup>
        {columns.map((column) => (
          <col key={column.key} style={column.width ? { width: column.width } : undefined} />
        ))}
      </colgroup>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead
              key={column.key}
              className={`sticky top-0 z-10 bg-surface-secondary px-200 ${
                isNumericColumn(column) ? "text-right" : ""
              }`}
            >
              {column.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, rowIndex) => (
          <TableRow key={rowIndex}>
            {columns.map((column) => {
              const value = row[column.key] ?? null;
              return (
                <TableCell key={column.key} className={cellClass(column, value)}>
                  {formatReportCell(column, value)}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
      <TableFooter className="sticky bottom-0 bg-surface-secondary">
        <TableRow>
          {columns.map((column, index) => {
            const value = totals[column.key];
            return (
              <TableCell
                key={column.key}
                className={`font-semibold ${cellClass(column, value ?? null)}`}
              >
                {index === 0 ? "Total" : value === undefined ? "" : formatReportCell(column, value)}
              </TableCell>
            );
          })}
        </TableRow>
        {footer.map((entry) => (
          <TableRow key={entry.label}>
            {columns.map((column, index) => {
              const value = entry.values[column.key];
              return (
                <TableCell key={column.key} className={cellClass(column, value ?? null)}>
                  {index === 0
                    ? entry.label
                    : value === undefined
                      ? ""
                      : formatReportCell(column, value)}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableFooter>
    </Table>
  );
}
