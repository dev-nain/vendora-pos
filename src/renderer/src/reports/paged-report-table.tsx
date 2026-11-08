import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@renderer/components/ui/button";
import type { ReportCellValue, ReportColumn } from "@shared/reports";
import { pageRangeLabel } from "../products/product-list";
import { ReportTable } from "./report-table";

export const REPORT_PAGE_SIZE = 500;

interface PagedReportTableProps<Row extends Record<string, ReportCellValue>> {
  label: string;
  busy: boolean;
  columns: ReportColumn<Row>[];
  rows: Row[];
  totals: Record<string, number | null>;
}

export function PagedReportTable<Row extends Record<string, ReportCellValue>>({
  label,
  busy,
  columns,
  rows,
  totals,
}: PagedReportTableProps<Row>) {
  const [page, setPage] = useState(0);
  const pageRows = rows.slice(page * REPORT_PAGE_SIZE, (page + 1) * REPORT_PAGE_SIZE);
  return (
    <div className="flex min-h-0 flex-col gap-300">
      <ReportTable label={label} busy={busy} columns={columns} rows={pageRows} totals={totals} />
      {rows.length > REPORT_PAGE_SIZE ? (
        <div className="flex items-center justify-between">
          <p className="m-0 text-[length:var(--font-size-350)] text-secondary tabular-nums">
            {pageRangeLabel(page, pageRows.length, rows.length, REPORT_PAGE_SIZE)}
          </p>
          <div className="flex items-center gap-200">
            <Button
              variant="secondary"
              disabled={page === 0}
              focusableWhenDisabled
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={(page + 1) * REPORT_PAGE_SIZE >= rows.length}
              focusableWhenDisabled
              onClick={() => setPage(page + 1)}
            >
              Next
              <ChevronRightIcon aria-hidden="true" size={16} strokeWidth={2} />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
