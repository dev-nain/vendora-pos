import { CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { isVarianceWarning, type CashMove, type ShiftReport } from "@shared/shifts";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { formatRupees } from "@renderer/lib/money";
import { cn } from "@renderer/lib/utils";
import { formatDateTime, formatTime } from "../lib/date-time";

export const formatSignedOut = (paisa: number): string =>
  paisa === 0 ? formatRupees(0) : `−${formatRupees(paisa)}`;

const sectionHeading =
  "m-0 text-[length:var(--font-size-400)] leading-[var(--line-height-tight)] font-semibold text-foreground";

const cellBase = "h-[var(--height-control-sm)] align-middle";
const amountCell = `${cellBase} pl-400 text-right tabular-nums`;
const captionCell = `${cellBase} pr-400 text-[length:var(--font-size-300)] text-tertiary`;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-200">
      <h3 id={id} className={sectionHeading}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function TotalRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr className="border-t border-line font-semibold">
      <th scope="row" colSpan={3} className={`${cellBase} text-left font-semibold`}>
        {label}
      </th>
      <td className={amountCell}>{children}</td>
    </tr>
  );
}

interface MovesProps {
  id: string;
  title: string;
  kind: "in" | "out";
  moves: CashMove[];
  totalPaisa: number;
  onDeleteMove?: ((move: CashMove, opener: HTMLElement) => void) | undefined;
}

function MovesSection({ id, title, kind, moves, totalPaisa, onDeleteMove }: MovesProps) {
  const amount = (paisa: number) => (kind === "out" ? formatSignedOut(paisa) : formatRupees(paisa));
  const amountClasses = cn(kind === "out" && "text-critical");
  return (
    <Section id={id} title={title}>
      <table className="w-full border-collapse text-[length:var(--font-size-350)]">
        <tbody>
          {moves.map((move) => (
            <tr key={move.id}>
              <td className={cn(captionCell, "w-[1%] whitespace-nowrap")}>
                {formatTime(move.createdAt)}
              </td>
              <td className={cn(cellBase, "pr-400 text-foreground")}>{move.reason}</td>
              <td className={cn(captionCell, "whitespace-nowrap")}>{move.createdBy.displayName}</td>
              <td className={cn(amountCell, amountClasses)}>{amount(move.amountPaisa)}</td>
              {onDeleteMove ? (
                <td className="w-[1%] pl-200 text-right">
                  <Button
                    variant="ghost"
                    aria-label={`Delete cash ${kind} ${formatRupees(move.amountPaisa)}, ${move.reason}`}
                    onClick={(event) => onDeleteMove(move, event.currentTarget)}
                  >
                    Delete
                  </Button>
                </td>
              ) : null}
            </tr>
          ))}
          {moves.length === 0 ? (
            <tr>
              <td colSpan={4} className={cn(cellBase, "text-secondary")}>
                None
              </td>
            </tr>
          ) : null}
          <TotalRow label="Total">
            <span className={amountClasses}>{amount(totalPaisa)}</span>
          </TotalRow>
        </tbody>
      </table>
    </Section>
  );
}

export function varianceLabel(variance: number): string {
  if (variance === 0) return "No variance";
  return `${variance < 0 ? "Short" : "Over"} ${formatRupees(Math.abs(variance))}`;
}

export function VarianceBadges({ variance, warnPaisa }: { variance: number; warnPaisa: number }) {
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-200">
      {variance === 0 ? (
        <Badge variant="success">
          <CircleCheckIcon aria-hidden="true" strokeWidth={2} />
          No variance
        </Badge>
      ) : (
        <span>{varianceLabel(variance)}</span>
      )}
      {isVarianceWarning(variance, warnPaisa) ? (
        <Badge variant="warning">
          <TriangleAlertIcon aria-hidden="true" strokeWidth={2} />
          Check
        </Badge>
      ) : null}
    </span>
  );
}

interface ShiftReportViewProps {
  title: ReactNode;
  report: ShiftReport;
  varianceWarnPaisa?: number;
  onDeleteMove?: ((move: CashMove, opener: HTMLElement) => void) | undefined;
}

export function ShiftReportView({
  title,
  report,
  varianceWarnPaisa = 0,
  onDeleteMove,
}: ShiftReportViewProps) {
  return (
    <div className="grid gap-500">
      <div className="flex flex-wrap items-baseline justify-between gap-x-400 gap-y-100">
        {title}
        <p className="m-0 text-[length:var(--font-size-300)] text-tertiary">
          Terminal {report.terminalCode}
          {" · "}Opened {formatDateTime(report.openedAt)} by {report.openedBy}
          {report.closedAt && report.closedBy
            ? ` · Closed ${formatDateTime(report.closedAt)} by ${report.closedBy}`
            : null}
        </p>
      </div>
      <Section id={`${report.shiftId}-float`} title="Opening float">
        <table className="w-full border-collapse text-[length:var(--font-size-350)]">
          <tbody>
            <tr>
              <th scope="row" className={`${cellBase} text-left font-normal text-foreground`}>
                Float
              </th>
              <td className={amountCell}>{formatRupees(report.openingFloatPaisa)}</td>
            </tr>
          </tbody>
        </table>
      </Section>
      <MovesSection
        id={`${report.shiftId}-cash-in`}
        title="Cash in"
        kind="in"
        moves={report.cashIn.moves}
        totalPaisa={report.cashIn.totalPaisa}
        onDeleteMove={onDeleteMove}
      />
      <MovesSection
        id={`${report.shiftId}-cash-out`}
        title="Cash out"
        kind="out"
        moves={report.cashOut.moves}
        totalPaisa={report.cashOut.totalPaisa}
        onDeleteMove={onDeleteMove}
      />
      <Section id={`${report.shiftId}-expected`} title="Expected by payment method">
        <table className="w-full border-collapse text-[length:var(--font-size-350)]">
          <tbody>
            {report.expectedByMethod.map((method) => (
              <tr key={method.method}>
                <th scope="row" className={`${cellBase} text-left font-normal text-foreground`}>
                  {method.label}
                </th>
                <td className={cn(amountCell, "font-semibold")}>
                  {method.expectedPaisa < 0
                    ? formatSignedOut(-method.expectedPaisa)
                    : formatRupees(method.expectedPaisa)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      {report.count && report.variancePaisa !== null ? (
        <Section id={`${report.shiftId}-counted`} title="Counted cash">
          <table className="w-full border-collapse text-[length:var(--font-size-350)]">
            <tbody>
              {report.count.method === "denominations" ? (
                report.count.lines.map((line) => (
                  <tr key={line.valuePaisa}>
                    <th scope="row" className={`${cellBase} text-left font-normal text-foreground`}>
                      {formatRupees(line.valuePaisa)} × {line.count}
                    </th>
                    <td className={amountCell}>{formatRupees(line.totalPaisa)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <th scope="row" className={`${cellBase} text-left font-normal text-secondary`}>
                    Entered as a total
                  </th>
                  <td className={amountCell} />
                </tr>
              )}
              <tr className="border-t border-line font-semibold">
                <th scope="row" className={`${cellBase} text-left font-semibold`}>
                  Counted
                </th>
                <td className={amountCell}>{formatRupees(report.count.countedCashPaisa)}</td>
              </tr>
              <tr>
                <th scope="row" className={`${cellBase} text-left font-semibold`}>
                  Variance
                </th>
                <td className={cn(amountCell, "font-semibold")}>
                  <VarianceBadges variance={report.variancePaisa} warnPaisa={varianceWarnPaisa} />
                </td>
              </tr>
            </tbody>
          </table>
        </Section>
      ) : null}
      {report.note ? (
        <Section id={`${report.shiftId}-note`} title="Note">
          <p className="m-0 text-[length:var(--font-size-350)] text-foreground">{report.note}</p>
        </Section>
      ) : null}
    </div>
  );
}
