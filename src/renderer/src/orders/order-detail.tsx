import { paymentMethodLabels } from "@shared/checkout";
import { printerMessages, type PrintResult } from "@shared/receipt";
import type { OrderDetail as OrderDetailData } from "@shared/sales";
import { PrintWarning } from "@renderer/components/print-warning";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import { cn } from "@renderer/lib/utils";
import { formatDateTime } from "../lib/date-time";
import { formatRupees } from "../lib/money";
import { formatQuantity } from "../lib/quantity";
import { orderMoney } from "./order-list";

type OrderLine = OrderDetailData["lines"][number];

function lineDetail(line: OrderLine): string {
  const price = formatRupees(line.unitPricePaisa);
  const isPack = line.packQtyMilli !== 1000;
  const qty =
    line.unit !== "piece" && !isPack
      ? formatQuantity(line.qtyMilli, line.unit)
      : String(line.qtyMilli / 1000);
  const base = isPack
    ? `${qty} × Pack (${formatQuantity(line.packQtyMilli, line.unit)}) at ${price}`
    : `${qty} × ${price}`;
  return line.isReturn ? `Return · ${base}` : base;
}

function Row({ label, value, critical }: { label: string; value: string; critical?: boolean }) {
  return (
    <div className="flex justify-between gap-400">
      <dt>{label}</dt>
      <dd className={cn("m-0 tabular-nums", critical && "text-critical")}>{value}</dd>
    </div>
  );
}

interface OrderDetailProps {
  order: OrderDetailData | null;
  loading: boolean;
  printing: boolean;
  result: PrintResult | null;
  canReturn: boolean;
  onReprint: () => void;
  onReturn: () => void;
}

export function OrderDetail({
  order,
  loading,
  printing,
  result,
  canReturn,
  onReprint,
  onReturn,
}: OrderDetailProps) {
  if (!order) {
    return (
      <p className="m-0 text-secondary">{loading ? "Loading…" : "Select a sale to see it here."}</p>
    );
  }
  const times = order.printCount === 1 ? "time" : "times";
  const noPrinter = result?.message === printerMessages.notSetUp && !result.successful;
  return (
    <div className="grid content-start gap-400">
      <div className="grid gap-050">
        <h2 className="m-0 text-[length:var(--font-size-550)] font-semibold text-foreground tabular-nums">
          {order.invoiceNo}
        </h2>
        <p className="m-0 text-[length:var(--font-size-300)] text-tertiary">
          {formatDateTime(order.createdAt)} · {order.cashierName}
        </p>
        {order.refundedInvoiceNo ? (
          <p className="m-0 text-[length:var(--font-size-300)] text-tertiary tabular-nums">
            Original invoice {order.refundedInvoiceNo}
          </p>
        ) : null}
      </div>
      <ul aria-label="Lines" className="m-0 grid list-none gap-200 p-0">
        {order.lines.map((line, index) => (
          <li key={index} className="flex items-start justify-between gap-300">
            <div className="grid min-w-0 gap-050">
              <span className="text-foreground">{line.nameEn}</span>
              {line.nameUr ? (
                <span
                  dir="rtl"
                  lang="ur"
                  className="text-right font-urdu leading-[var(--line-height-urdu)] text-secondary"
                >
                  {line.nameUr}
                </span>
              ) : null}
              <span className="text-[length:var(--font-size-300)] text-tertiary tabular-nums">
                {lineDetail(line)}
              </span>
              {line.discountPaisa !== 0 ? (
                <span className="text-[length:var(--font-size-300)] text-critical tabular-nums">
                  Discount {orderMoney(-line.discountPaisa)}
                </span>
              ) : null}
            </div>
            <span className="shrink-0 text-foreground tabular-nums">
              {orderMoney(line.totalPaisa)}
            </span>
          </li>
        ))}
      </ul>
      <dl className="m-0 grid gap-050 border-t border-line pt-300 text-[length:var(--font-size-350)] text-secondary">
        <Row label="Subtotal" value={orderMoney(order.subtotalPaisa)} />
        {order.discountPaisa > 0 ? (
          <Row label="Discount" value={orderMoney(-order.discountPaisa)} critical />
        ) : null}
        <Row label="Sales tax" value={orderMoney(order.taxPaisa)} />
        {order.roundingPaisa !== 0 ? (
          <Row label="Rounding" value={orderMoney(order.roundingPaisa)} />
        ) : null}
        <div className="flex justify-between gap-400 text-[length:var(--font-size-450)] font-semibold text-foreground">
          <dt>Total</dt>
          <dd className={cn("m-0 tabular-nums", order.totalPaisa < 0 && "text-critical")}>
            {orderMoney(order.totalPaisa)}
          </dd>
        </div>
      </dl>
      <dl className="m-0 grid gap-050 border-t border-line pt-300 text-[length:var(--font-size-350)] text-secondary">
        {order.payments.map((payment, index) => (
          <Row
            key={index}
            label={
              payment.reference
                ? `${paymentMethodLabels[payment.method]} ${payment.reference}`
                : paymentMethodLabels[payment.method]
            }
            value={orderMoney(payment.amountPaisa)}
          />
        ))}
        {order.changePaisa > 0 ? (
          <Row label="Change" value={formatRupees(order.changePaisa)} />
        ) : null}
      </dl>
      {order.buyerName || order.buyerNtn ? (
        <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
          Buyer {[order.buyerName, order.buyerNtn].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      <p className="m-0 text-[length:var(--font-size-300)] text-tertiary">
        Printed {order.printCount} {times}
      </p>
      <div className="grid gap-200">
        <Button disabled={printing} onClick={onReprint}>
          {printing ? "Printing…" : "Reprint"}
          <Kbd>Ctrl+P</Kbd>
        </Button>
        <Button
          id="return-items-button"
          variant="secondary"
          disabled={!canReturn}
          onClick={onReturn}
        >
          Return items
          <Kbd>Ctrl+R</Kbd>
        </Button>
        {canReturn ? null : (
          <p className="m-0 text-[length:var(--font-size-300)] text-tertiary">
            Nothing left to return.
          </p>
        )}
        {result?.successful ? (
          <p role="status" className="m-0 text-[length:var(--font-size-350)] text-secondary">
            Receipt sent to the printer.
          </p>
        ) : null}
        {result && !result.successful ? (
          <PrintWarning
            title={noPrinter ? printerMessages.notSetUp : printerMessages.didNotPrint}
            message={noPrinter ? undefined : result.message}
            onRetry={result.canRetry ? onReprint : undefined}
            retryDisabled={printing}
          />
        ) : null}
      </div>
    </div>
  );
}
