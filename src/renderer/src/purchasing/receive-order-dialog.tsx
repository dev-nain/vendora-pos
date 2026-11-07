import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { PurchaseOrder, PurchaseOrderSummary } from "@shared/purchase-orders";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { formatDate } from "@renderer/lib/date-time";
import { formatRupees } from "@renderer/lib/money";
import { cn } from "@renderer/lib/utils";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { ErrorLine } from "../users/form-parts";
import { receivableOrders } from "./grn-form";
import { OrderStatusBadge } from "./order-status-badge";

interface ReceiveOrderDialogProps {
  open: boolean;
  onClose: () => void;
  onPick: (order: PurchaseOrder) => void;
  onSessionEnded: () => void;
}

type PickerProps = Pick<ReceiveOrderDialogProps, "onPick" | "onSessionEnded">;

function OrderPicker({ onPick, onSessionEnded }: PickerProps) {
  const [orders, setOrders] = useState<PurchaseOrderSummary[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    window.vendora.purchaseOrders
      .list()
      .then((fetched) => setOrders(receivableOrders(fetched)))
      .catch((cause: unknown) => {
        if (isSessionError(cause)) onSessionEnded();
        else setError(serviceErrorMessage);
      });
  }, [onSessionEnded]);

  useEffect(() => {
    if (orders === null) return;
    listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[activeIndex]?.focus();
  }, [activeIndex, orders]);

  const choose = async (summary: PurchaseOrderSummary) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setError(null);
    try {
      const result = await window.vendora.purchaseOrders.get(summary.id);
      if (result.ok) {
        onPick(result.order);
        return;
      }
      setError(result.message);
    } catch (cause) {
      if (isSessionError(cause)) {
        onSessionEnded();
        return;
      }
      setError(serviceErrorMessage);
    }
    pendingRef.current = false;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!orders || orders.length === 0) return;
    const last = orders.length - 1;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, last));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(last);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const picked = orders[activeIndex];
      if (picked) void choose(picked);
    }
  };

  return (
    <div>
      <DialogHeader>
        <DialogTitle>Receive from a purchase order</DialogTitle>
        <DialogDescription>Pick the order the delivery is for.</DialogDescription>
        {error ? <ErrorLine>{error}</ErrorLine> : null}
        {orders === null ? (
          error ? null : (
            <p className="m-0 text-secondary">Loading purchase orders…</p>
          )
        ) : orders.length === 0 ? (
          <div className="grid gap-100 text-center">
            <p className="m-0 font-semibold text-foreground">No purchase orders to receive.</p>
            <p className="m-0 text-secondary">Confirm an order first, or receive directly.</p>
          </div>
        ) : (
          <ul
            ref={listRef}
            role="listbox"
            aria-label="Purchase orders to receive"
            className="m-0 grid max-h-[320px] list-none gap-050 overflow-y-auto p-0"
            onKeyDown={onKeyDown}
          >
            {orders.map((order, index) => (
              <li
                key={order.id}
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={index === activeIndex ? 0 : -1}
                className={cn(
                  "grid min-h-[var(--height-control-lg)] cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-300 rounded-100 px-300 py-100 outline-none focus-visible:shadow-focus",
                  index === activeIndex ? "bg-surface-selected" : "hover:bg-surface-hover",
                )}
                onClick={() => void choose(order)}
                onMouseMove={() => setActiveIndex(index)}
              >
                <span className="truncate font-semibold tabular-nums text-foreground">
                  {order.orderNo}
                  <span className="font-normal text-secondary"> · {order.supplierName}</span>
                </span>
                <OrderStatusBadge status={order.status} />
                <span className="text-[length:var(--font-size-300)] tabular-nums text-secondary">
                  {formatDate(order.createdAt)} · {formatRupees(order.totalPaisa)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogHeader>
    </div>
  );
}

export function ReceiveOrderDialog({ open, onClose, ...rest }: ReceiveOrderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>{open ? <OrderPicker {...rest} /> : null}</DialogContent>
    </Dialog>
  );
}
