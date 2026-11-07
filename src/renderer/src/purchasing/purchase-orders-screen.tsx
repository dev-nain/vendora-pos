import { ChevronLeftIcon, ChevronRightIcon, ClipboardListIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  purchaseOrderStatuses,
  purchaseOrderStatusLabels,
  type PurchaseOrderStatus,
  type PurchaseOrderSummary,
} from "@shared/purchase-orders";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { formatDate } from "@renderer/lib/date-time";
import { formatRupees } from "@renderer/lib/money";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { PRODUCT_PAGE_SIZE, isTypingTarget, pageRangeLabel } from "../products/product-list";
import { ErrorLine } from "../users/form-parts";
import { filterOrders, supplierOptions } from "./order-list";
import { OrderStatusBadge } from "./order-status-badge";

const ALL = "all";

type View = { kind: "list" } | { kind: "form"; orderId: string | null };

interface PurchaseOrdersScreenProps {
  onSessionEnded: () => void;
}

export function PurchaseOrdersScreen({ onSessionEnded }: PurchaseOrdersScreenProps) {
  const [view, setView] = useState<View>({ kind: "list" });

  return view.kind === "list" ? (
    <OrderList
      onSessionEnded={onSessionEnded}
      onNew={() => setView({ kind: "form", orderId: null })}
      onOpen={(orderId) => setView({ kind: "form", orderId })}
    />
  ) : (
    <Button variant="secondary" autoFocus onClick={() => setView({ kind: "list" })}>
      <ChevronLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
      Purchase orders
    </Button>
  );
}

interface OrderListProps {
  onSessionEnded: () => void;
  onNew: () => void;
  onOpen: (orderId: string) => void;
}

function OrderList({ onSessionEnded, onNew, onOpen }: OrderListProps) {
  const [orders, setOrders] = useState<PurchaseOrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [status, setStatus] = useState<PurchaseOrderStatus | null>(null);
  const [page, setPage] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);

  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const requestId = useRef(0);

  const load = useCallback(() => {
    const id = ++requestId.current;
    window.vendora.purchaseOrders
      .list()
      .then((fetched) => {
        if (id !== requestId.current) return;
        setOrders(fetched);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        if (isSessionError(cause)) {
          onSessionEnded();
          return;
        }
        setError(serviceErrorMessage);
      });
  }, [onSessionEnded]);

  useEffect(load, [load]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        onNew();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onNew]);

  const filtered = filterOrders(orders ?? [], { supplierId, status });
  const pageItems = filtered.slice(page * PRODUCT_PAGE_SIZE, (page + 1) * PRODUCT_PAGE_SIZE);

  const focusRow = (index: number) => {
    setActiveIndex(index);
    const row = bodyRef.current?.querySelectorAll<HTMLElement>("tr")[index];
    row?.focus();
    row?.scrollIntoView?.({ block: "nearest" });
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, index: number) => {
    if (event.target !== event.currentTarget) return;
    const last = pageItems.length - 1;
    const target =
      event.key === "ArrowDown"
        ? Math.min(index + 1, last)
        : event.key === "ArrowUp"
          ? Math.max(index - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (target !== null) {
      event.preventDefault();
      focusRow(target);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const order = pageItems[index];
      if (order) onOpen(order.id);
    }
  };

  const resetPaging = () => {
    setPage(0);
    setActiveIndex(0);
  };

  const suppliers = supplierOptions(orders ?? []);
  const supplierItems = [
    { value: ALL, label: "All suppliers" },
    ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name })),
  ];
  const statusItems = [
    { value: ALL, label: "All statuses" },
    ...purchaseOrderStatuses.map((value) => ({
      value,
      label: purchaseOrderStatusLabels[value],
    })),
  ];

  const filtering = supplierId !== null || status !== null;
  const empty = filtering
    ? { title: "No purchase orders match", text: "Try another supplier or status." }
    : { title: "No purchase orders yet", text: "Create one to order stock from a supplier." };

  return (
    <div className="flex flex-col gap-500">
      <div className="grid gap-100">
        <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
          Purchase orders
        </h1>
        <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
          Order stock from your suppliers.
        </p>
      </div>
      <div className="flex items-center justify-between gap-300">
        <div className="flex items-center gap-300">
          <Select
            items={supplierItems}
            value={supplierId ?? ALL}
            onValueChange={(next) => {
              if (typeof next !== "string") return;
              setSupplierId(next === ALL ? null : next);
              resetPaging();
            }}
          >
            <SelectTrigger aria-label="Supplier" className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {supplierItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            items={statusItems}
            value={status ?? ALL}
            onValueChange={(next) => {
              if (typeof next !== "string") return;
              setStatus(next === ALL ? null : (next as PurchaseOrderStatus));
              resetPaging();
            }}
          >
            <SelectTrigger aria-label="Status" className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button autoFocus onClick={onNew}>
          <PlusIcon aria-hidden="true" size={16} strokeWidth={2} />
          New purchase order
          <Kbd>N</Kbd>
        </Button>
      </div>
      {error ? (
        <div className="flex items-center gap-300">
          <ErrorLine>{error}</ErrorLine>
          <Button variant="secondary" onClick={load}>
            Try again
          </Button>
        </div>
      ) : null}
      {orders === null ? (
        error ? null : (
          <p className="m-0 text-secondary">Loading purchase orders…</p>
        )
      ) : pageItems.length === 0 ? (
        <div className="flex flex-col items-center gap-100 rounded-300 border border-line-card bg-surface-secondary py-1200 text-center">
          <ClipboardListIcon
            aria-hidden="true"
            size={24}
            strokeWidth={2}
            className="text-icon-muted"
          />
          <p className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground">
            {empty.title}
          </p>
          <p className="m-0 text-secondary">{empty.text}</p>
        </div>
      ) : (
        <Table className="table-fixed" aria-label="Purchase orders">
          <colgroup>
            <col className="w-[168px]" />
            <col />
            <col className="w-[152px]" />
            <col className="w-[72px]" />
            <col className="w-[148px]" />
            <col className="w-[160px]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody ref={bodyRef}>
            {pageItems.map((order, index) => (
              <TableRow
                key={order.id}
                tabIndex={index === activeIndex ? 0 : -1}
                aria-selected={index === activeIndex}
                className="cursor-pointer outline-none focus-visible:shadow-focus"
                onFocus={() => setActiveIndex(index)}
                onClick={() => onOpen(order.id)}
                onKeyDown={(event) => onRowKeyDown(event, index)}
              >
                <TableCell className="font-semibold tabular-nums text-foreground">
                  {order.orderNo}
                </TableCell>
                <TableCell className="truncate" title={order.supplierName}>
                  {order.supplierName}
                </TableCell>
                <TableCell className="tabular-nums">{formatDate(order.createdAt)}</TableCell>
                <TableCell className="text-right tabular-nums">{order.lineCount}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatRupees(order.totalPaisa)}
                </TableCell>
                <TableCell>
                  <OrderStatusBadge status={order.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {filtered.length > PRODUCT_PAGE_SIZE ? (
        <div className="flex items-center justify-between">
          <p className="m-0 text-[length:var(--font-size-350)] text-secondary tabular-nums">
            {pageRangeLabel(page, pageItems.length, filtered.length)}
          </p>
          <div className="flex items-center gap-200">
            <Button
              variant="secondary"
              disabled={page === 0}
              focusableWhenDisabled
              onClick={() => {
                setPage(page - 1);
                setActiveIndex(0);
              }}
            >
              <ChevronLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={(page + 1) * PRODUCT_PAGE_SIZE >= filtered.length}
              focusableWhenDisabled
              onClick={() => {
                setPage(page + 1);
                setActiveIndex(0);
              }}
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
