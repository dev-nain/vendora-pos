import { ChevronLeftIcon, ChevronRightIcon, PackageMinusIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  purchaseReturnReasonLabels,
  type PurchaseReturnListResult,
} from "@shared/purchase-returns";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
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
import type { LeaveGuard } from "./order-form-screen";
import { ReturnDetail } from "./return-detail";
import { ReturnFormScreen, type ReturnStart } from "./return-form-screen";

type View =
  | { kind: "list" }
  | { kind: "form"; start: ReturnStart }
  | { kind: "return"; id: string; status: string | null };

interface PurchaseReturnsScreenProps {
  seed: string | null;
  registerLeaveGuard: (guard: LeaveGuard | null) => void;
  onSeedUsed: () => void;
  onSessionEnded: () => void;
}

export function PurchaseReturnsScreen({
  seed,
  registerLeaveGuard,
  onSeedUsed,
  onSessionEnded,
}: PurchaseReturnsScreenProps) {
  const [view, setView] = useState<View>(
    seed ? { kind: "form", start: { kind: "note", noteId: seed } } : { kind: "list" },
  );

  useEffect(() => {
    if (seed) onSeedUsed();
  }, [seed, onSeedUsed]);

  const backToList = useCallback(() => setView({ kind: "list" }), []);

  if (view.kind === "list") {
    return (
      <ReturnList
        onSessionEnded={onSessionEnded}
        onNew={() => setView({ kind: "form", start: { kind: "supplier" } })}
        onOpen={(id) => setView({ kind: "return", id, status: null })}
      />
    );
  }
  if (view.kind === "form") {
    return (
      <ReturnFormScreen
        start={view.start}
        registerLeaveGuard={registerLeaveGuard}
        onBack={backToList}
        onPosted={(purchaseReturn) =>
          setView({
            kind: "return",
            id: purchaseReturn.id,
            status: `Posted ${purchaseReturn.returnNo}.`,
          })
        }
        onSessionEnded={onSessionEnded}
      />
    );
  }
  return (
    <ReturnDetail
      id={view.id}
      status={view.status}
      onBack={backToList}
      onSessionEnded={onSessionEnded}
    />
  );
}

interface ReturnListProps {
  onSessionEnded: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
}

function ReturnList({ onSessionEnded, onNew, onOpen }: ReturnListProps) {
  const [result, setResult] = useState<PurchaseReturnListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);

  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const requestId = useRef(0);

  const fail = useCallback(
    (cause: unknown) => {
      if (isSessionError(cause)) onSessionEnded();
      else setError(serviceErrorMessage);
    },
    [onSessionEnded],
  );

  const load = useCallback(() => {
    const id = ++requestId.current;
    window.vendora.purchaseReturns
      .list({ limit: PRODUCT_PAGE_SIZE, offset: page * PRODUCT_PAGE_SIZE })
      .then((fetched) => {
        if (id !== requestId.current) return;
        setResult(fetched);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (id === requestId.current) fail(cause);
      });
  }, [page, fail]);

  useEffect(load, [load]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || isTypingTarget(event.target)) return;
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        onNew();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onNew]);

  const items = result?.items ?? [];
  const total = result?.total ?? 0;

  const focusRow = (index: number) => {
    setActiveIndex(index);
    const row = bodyRef.current?.querySelectorAll<HTMLElement>("tr")[index];
    row?.focus();
    row?.scrollIntoView?.({ block: "nearest" });
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, index: number) => {
    if (event.target !== event.currentTarget) return;
    const last = items.length - 1;
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
      const purchaseReturn = items[index];
      if (purchaseReturn) onOpen(purchaseReturn.id);
    }
  };

  return (
    <div className="flex flex-col gap-500">
      <div className="grid gap-100">
        <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
          Purchase returns
        </h1>
        <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
          Goods sent back to suppliers.
        </p>
      </div>
      <div className="flex items-start justify-between gap-300">
        <p className="m-0 max-w-[560px] text-[length:var(--font-size-350)] text-secondary">
          To return goods from a delivery, open it under Goods received and press R.
        </p>
        <Button onClick={onNew}>
          <PlusIcon aria-hidden="true" size={16} strokeWidth={2} />
          Return from supplier
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
      {result === null ? (
        error ? null : (
          <p className="m-0 text-secondary">Loading purchase returns…</p>
        )
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-100 rounded-300 border border-line-card bg-surface-secondary py-1200 text-center">
          <PackageMinusIcon
            aria-hidden="true"
            size={24}
            strokeWidth={2}
            className="text-icon-muted"
          />
          <p className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground">
            No purchase returns yet.
          </p>
        </div>
      ) : (
        <Table className="table-fixed" aria-label="Purchase returns">
          <colgroup>
            <col className="w-[168px]" />
            <col />
            <col className="w-[168px]" />
            <col className="w-[140px]" />
            <col className="w-[124px]" />
            <col className="w-[64px]" />
            <col className="w-[132px]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>Return</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>GRN</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody ref={bodyRef}>
            {items.map((purchaseReturn, index) => (
              <TableRow
                key={purchaseReturn.id}
                tabIndex={index === activeIndex ? 0 : -1}
                aria-selected={index === activeIndex}
                className="cursor-pointer outline-none focus-visible:shadow-focus"
                onFocus={() => setActiveIndex(index)}
                onClick={() => onOpen(purchaseReturn.id)}
                onKeyDown={(event) => onRowKeyDown(event, index)}
              >
                <TableCell className="font-semibold tabular-nums text-foreground">
                  {purchaseReturn.returnNo}
                </TableCell>
                <TableCell className="truncate" title={purchaseReturn.supplierName}>
                  {purchaseReturn.supplierName}
                </TableCell>
                <TableCell className="tabular-nums">
                  {purchaseReturn.grnNo ?? <span className="text-tertiary">None</span>}
                </TableCell>
                <TableCell>{purchaseReturnReasonLabels[purchaseReturn.reason]}</TableCell>
                <TableCell className="tabular-nums">
                  {formatDate(purchaseReturn.createdAt)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {purchaseReturn.lineCount}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatRupees(purchaseReturn.totalPaisa)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {total > PRODUCT_PAGE_SIZE ? (
        <div className="flex items-center justify-between">
          <p className="m-0 text-[length:var(--font-size-350)] text-secondary tabular-nums">
            {pageRangeLabel(page, items.length, total)}
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
              disabled={(page + 1) * PRODUCT_PAGE_SIZE >= total}
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
