import { paymentMethodLabels } from "@shared/checkout";
import { ordersListLimit, type OrderSummary } from "@shared/sales";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { cn } from "@renderer/lib/utils";
import { negativeRupees } from "../billing/bill-format";
import { formatDateTime, formatTime } from "../lib/date-time";
import { formatRupees } from "../lib/money";

export const orderMoney = (paisa: number): string =>
  paisa < 0 ? negativeRupees(-paisa) : formatRupees(paisa);

interface OrderListProps {
  orders: OrderSummary[];
  selectedId: string | null;
  showDate: boolean;
  emptyText: string;
  onSelect: (id: string) => void;
}

export function OrderList({ orders, selectedId, showDate, emptyText, onSelect }: OrderListProps) {
  if (orders.length === 0) {
    return <p className="m-0 px-400 py-300 text-secondary">{emptyText}</p>;
  }
  return (
    <div className="grid gap-200">
      <Table aria-label="Orders">
        <TableHeader>
          <TableRow>
            <TableHead>Invoice</TableHead>
            <TableHead>{showDate ? "Date and time" : "Time"}</TableHead>
            <TableHead>Cashier</TableHead>
            <TableHead>Payment</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow
              key={order.id}
              aria-selected={order.id === selectedId}
              onClick={() => onSelect(order.id)}
            >
              <TableCell className="font-semibold tabular-nums">
                <button
                  type="button"
                  className="min-h-[var(--height-control-md)] cursor-default rounded-100 bg-transparent p-0 text-left font-semibold text-foreground tabular-nums outline-none focus-visible:shadow-focus"
                  onClick={() => onSelect(order.id)}
                >
                  {order.invoiceNo}
                </button>
              </TableCell>
              <TableCell className="whitespace-nowrap text-secondary">
                {showDate ? formatDateTime(order.createdAt) : formatTime(order.createdAt)}
              </TableCell>
              <TableCell className="text-secondary">{order.cashierName}</TableCell>
              <TableCell className="text-secondary">
                {order.methods.map((method) => paymentMethodLabels[method]).join(", ")}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right whitespace-nowrap tabular-nums",
                  order.totalPaisa < 0 && "text-critical",
                )}
              >
                {orderMoney(order.totalPaisa)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {orders.length >= ordersListLimit ? (
        <p className="m-0 text-[length:var(--font-size-300)] text-tertiary">
          Showing the newest {ordersListLimit}. Pick a date or type an invoice number to find older
          sales.
        </p>
      ) : null}
    </div>
  );
}
