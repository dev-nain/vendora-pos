import type { Bill } from "@shared/checkout";
import { cn } from "@renderer/lib/utils";
import { formatRupees } from "../lib/money";
import { signedRupees } from "./bill-format";
import { Row } from "./bill-totals";
import type { PaymentSummary } from "./payment-lines";

export function PaymentHero({ summary }: { summary: PaymentSummary }) {
  const showChange = summary.changePaisa > 0;
  const refund = summary.refundMode;
  const label = refund
    ? summary.overPaisa > 0
      ? "Over by"
      : "Left to refund"
    : showChange
      ? "Change"
      : "Left to pay";
  const figure = refund
    ? summary.overPaisa > 0
      ? summary.overPaisa
      : summary.remainingPaisa
    : showChange
      ? summary.changePaisa
      : summary.remainingPaisa;
  return (
    <div className="flex items-end justify-between gap-400">
      <div className="grid">
        <span className="text-[length:var(--font-size-450)] font-semibold text-secondary">
          {label}
        </span>
        <output
          aria-live="polite"
          className="font-display text-[length:var(--font-size-1400)] leading-[var(--line-height-tight)] font-semibold text-foreground tabular-nums"
        >
          {formatRupees(figure)}
        </output>
      </div>
      <div className="grid justify-items-end">
        <span className="text-[length:var(--font-size-350)] text-secondary">
          {refund ? "Refund" : "Total"}
        </span>
        <span
          className={cn(
            "text-[length:var(--font-size-900)] font-semibold tabular-nums",
            refund ? "text-critical" : "text-foreground",
          )}
        >
          {signedRupees(summary.totalPaisa)}
        </span>
      </div>
    </div>
  );
}

export function PaymentTotals({ bill, summary }: { bill: Bill; summary: PaymentSummary }) {
  const { totals } = bill;
  return (
    <dl className="m-0 grid gap-100 text-[length:var(--font-size-350)] text-secondary">
      <Row label="Subtotal" value={signedRupees(totals.subtotalPaisa)} />
      {totals.discountPaisa !== 0 ? (
        <Row
          label="Discount"
          value={signedRupees(-totals.discountPaisa)}
          critical={totals.discountPaisa > 0}
        />
      ) : null}
      <Row label="Sales tax" value={signedRupees(totals.taxPaisa)} />
      {summary.roundingPaisa !== 0 ? (
        <Row label="Rounding" value={signedRupees(summary.roundingPaisa)} />
      ) : null}
      <div className="flex justify-between gap-400 font-semibold text-foreground">
        <dt>{summary.refundMode ? "Refund" : "Total"}</dt>
        <dd className={cn("m-0 tabular-nums", summary.totalPaisa < 0 && "text-critical")}>
          {signedRupees(summary.totalPaisa)}
        </dd>
      </div>
    </dl>
  );
}
