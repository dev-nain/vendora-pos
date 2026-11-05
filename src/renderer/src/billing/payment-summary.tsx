import type { Bill } from "@shared/checkout";
import { formatRupees } from "../lib/money";
import { negativeRupees } from "./bill-format";
import { Row } from "./bill-totals";
import type { PaymentSummary } from "./payment-lines";

export function PaymentHero({ summary }: { summary: PaymentSummary }) {
  const showChange = summary.changePaisa > 0;
  return (
    <div className="flex items-end justify-between gap-400">
      <div className="grid">
        <span className="text-[length:var(--font-size-450)] font-semibold text-secondary">
          {showChange ? "Change" : "Left to pay"}
        </span>
        <output
          aria-live="polite"
          className="font-display text-[length:var(--font-size-1400)] leading-[var(--line-height-tight)] font-semibold text-foreground tabular-nums"
        >
          {formatRupees(showChange ? summary.changePaisa : summary.remainingPaisa)}
        </output>
      </div>
      <div className="grid justify-items-end">
        <span className="text-[length:var(--font-size-350)] text-secondary">Total</span>
        <span className="text-[length:var(--font-size-900)] font-semibold text-foreground tabular-nums">
          {formatRupees(summary.totalPaisa)}
        </span>
      </div>
    </div>
  );
}

export function PaymentTotals({ bill, summary }: { bill: Bill; summary: PaymentSummary }) {
  const { totals } = bill;
  return (
    <dl className="m-0 grid gap-100 text-[length:var(--font-size-350)] text-secondary">
      <Row label="Subtotal" value={formatRupees(totals.subtotalPaisa)} />
      {totals.discountPaisa > 0 ? (
        <Row label="Discount" value={negativeRupees(totals.discountPaisa)} critical />
      ) : null}
      <Row label="Sales tax" value={formatRupees(totals.taxPaisa)} />
      {summary.roundingPaisa !== 0 ? (
        <Row
          label="Rounding"
          value={
            summary.roundingPaisa < 0
              ? negativeRupees(-summary.roundingPaisa)
              : formatRupees(summary.roundingPaisa)
          }
        />
      ) : null}
      <div className="flex justify-between gap-400 font-semibold text-foreground">
        <dt>Total</dt>
        <dd className="m-0 tabular-nums">{formatRupees(summary.totalPaisa)}</dd>
      </div>
    </dl>
  );
}
