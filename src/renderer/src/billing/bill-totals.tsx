import type { Bill } from "@shared/checkout";
import { formatRupees } from "../lib/money";
import { billDiscountLabel, itemCountText, negativeRupees } from "./bill-format";

export function Row({
  label,
  value,
  critical,
}: {
  label: string;
  value: string;
  critical?: boolean;
}) {
  return (
    <div className="flex justify-between gap-400">
      <dt>{label}</dt>
      <dd className={critical ? "m-0 text-critical tabular-nums" : "m-0 tabular-nums"}>{value}</dd>
    </div>
  );
}

export function BillTotals({ bill }: { bill: Bill | null }) {
  const totals = bill?.totals;
  const billDiscountPaisa = bill?.lines.reduce((sum, line) => sum + line.billDiscountPaisa, 0) ?? 0;
  const lineDiscountPaisa = (totals?.discountPaisa ?? 0) - billDiscountPaisa;

  return (
    <section aria-label="Totals" className="grid gap-100 border-t border-line px-600 py-300">
      <dl className="m-0 grid gap-050 text-[length:var(--font-size-350)] text-secondary">
        <Row label="Subtotal" value={formatRupees(totals?.subtotalPaisa ?? 0)} />
        {lineDiscountPaisa > 0 ? (
          <Row label="Discount" value={negativeRupees(lineDiscountPaisa)} critical />
        ) : null}
        {bill?.billDiscount ? (
          <Row
            label={billDiscountLabel(bill.billDiscount)}
            value={negativeRupees(billDiscountPaisa)}
            critical
          />
        ) : null}
        <Row label="Sales tax" value={formatRupees(totals?.taxPaisa ?? 0)} />
        {totals && totals.roundingPaisa !== 0 ? (
          <Row
            label="Rounding"
            value={
              totals.roundingPaisa < 0
                ? negativeRupees(-totals.roundingPaisa)
                : formatRupees(totals.roundingPaisa)
            }
          />
        ) : null}
      </dl>
      <div className="flex items-end justify-between gap-400">
        <div className="grid">
          <span className="text-[length:var(--font-size-450)] font-semibold text-foreground">
            Total
          </span>
          <span className="text-[length:var(--font-size-300)] text-secondary">
            {itemCountText(bill?.lines.length ?? 0)}
          </span>
        </div>
        <output className="font-display text-[length:var(--font-size-1400)] leading-[var(--line-height-tight)] font-semibold text-foreground tabular-nums">
          {formatRupees(totals?.totalPaisa ?? 0)}
        </output>
      </div>
    </section>
  );
}
