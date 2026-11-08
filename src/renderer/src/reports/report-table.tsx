import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { formatReportCell, isNumericColumn, type ReportColumn } from "@shared/reports";
import { negativeClass } from "../inventory/stock-format";

interface ReportTableProps<Row extends Record<string, string | number>> {
  label: string;
  busy: boolean;
  columns: ReportColumn<Row>[];
  rows: Row[];
  totals: Record<string, number>;
}

const cellClass = (column: { format: string }, value: string | number) =>
  `px-200 whitespace-nowrap ${
    column.format === "day" || column.format === "text" ? "" : "text-right tabular-nums"
  } ${typeof value === "number" ? negativeClass(value) : ""}`;

export function ReportTable<Row extends Record<string, string | number>>({
  label,
  busy,
  columns,
  rows,
  totals,
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
        {rows.map((row) => (
          <TableRow key={String(row[columns[0]?.key ?? ""])}>
            {columns.map((column) => {
              const value = row[column.key] ?? "";
              return (
                <TableCell key={column.key} className={cellClass(column, value)}>
                  {formatReportCell(column, value)}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          {columns.map((column, index) => {
            const value = totals[column.key];
            return (
              <TableCell
                key={column.key}
                className={`sticky bottom-0 bg-surface-secondary font-semibold ${cellClass(
                  column,
                  value ?? "",
                )}`}
              >
                {index === 0 ? "Total" : value === undefined ? "" : formatReportCell(column, value)}
              </TableCell>
            );
          })}
        </TableRow>
      </TableFooter>
    </Table>
  );
}
