import { ChevronLeftIcon, ChevronRightIcon, PackageIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import type { NegativeStockResult } from "@shared/inventory";
import { Button } from "@renderer/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { signedRupees } from "../billing/bill-format";
import { formatDateTime } from "../lib/date-time";
import { ProductNameCell } from "../products/product-cells";
import { PRODUCT_PAGE_SIZE, pageRangeLabel } from "../products/product-list";
import { ErrorLine } from "../users/form-parts";
import { negativeClass, onHandText, rowMoveTarget } from "./stock-format";
import { StockHistory } from "./stock-history";

interface NegativeStockScreenProps {
  onSessionEnded: () => void;
}

const requestKey = (page: number, reloadKey: number): string => JSON.stringify([page, reloadKey]);

export function NegativeStockScreen({ onSessionEnded }: NegativeStockScreenProps) {
  const [page, setPage] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<NegativeStockResult | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);

  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const requestId = useRef(0);
  const restoreFocus = useRef(false);
  const focusedFirstRow = useRef(false);

  const fail = useCallback(
    (cause: unknown) => {
      if (isSessionError(cause)) {
        onSessionEnded();
        return;
      }
      setError(serviceErrorMessage);
    },
    [onSessionEnded],
  );

  useEffect(() => {
    const id = ++requestId.current;
    const key = requestKey(page, reloadKey);
    window.vendora.inventory
      .negativeStock({ limit: PRODUCT_PAGE_SIZE, offset: page * PRODUCT_PAGE_SIZE })
      .then((fetched) => {
        if (id !== requestId.current) return;
        if (fetched.items.length === 0 && page > 0) {
          setPage(0);
          setActiveIndex(0);
          return;
        }
        setResult(fetched);
        setError(null);
        setLoadedKey(key);
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        setLoadedKey(key);
        fail(cause);
      });
  }, [page, reloadKey, fail]);

  const items = result?.items ?? [];

  useEffect(() => {
    if (focusedFirstRow.current || items.length === 0) return;
    focusedFirstRow.current = true;
    bodyRef.current?.querySelectorAll<HTMLElement>("tr")[0]?.focus();
  }, [items.length]);

  useLayoutEffect(() => {
    if (historyIndex !== null || !restoreFocus.current) return;
    restoreFocus.current = false;
    bodyRef.current?.querySelectorAll<HTMLElement>("tr")[activeIndex]?.focus();
  }, [historyIndex, activeIndex]);

  const focusRow = (index: number) => {
    setActiveIndex(index);
    bodyRef.current?.querySelectorAll<HTMLElement>("tr")[index]?.focus();
  };

  const openHistory = (index: number) => {
    setActiveIndex(index);
    setHistoryIndex(index);
  };

  const closeHistory = () => {
    restoreFocus.current = true;
    setHistoryIndex(null);
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, index: number) => {
    if (event.target !== event.currentTarget) return;
    const target = rowMoveTarget(event.key, index, items.length - 1);
    if (target !== null) {
      event.preventDefault();
      focusRow(target);
    } else if (event.key === "Enter") {
      event.preventDefault();
      openHistory(index);
    }
  };

  const historyItem = historyIndex === null ? undefined : items[historyIndex];
  if (historyIndex !== null && historyItem) {
    return (
      <StockHistory
        productId={historyItem.id}
        backLabel="Back to negative stock"
        onBack={closeHistory}
        onSessionEnded={onSessionEnded}
      />
    );
  }

  const total = result?.total ?? 0;

  return (
    <div className="flex flex-col gap-500">
      <div className="grid gap-100">
        <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
          Negative stock
        </h1>
        <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
          Products with stock below zero. Select one and press Enter to see its movements.
        </p>
      </div>
      {error ? (
        <div className="flex items-center gap-300">
          <ErrorLine>{error}</ErrorLine>
          <Button variant="secondary" onClick={() => setReloadKey((key) => key + 1)}>
            Try again
          </Button>
        </div>
      ) : null}
      {result === null ? (
        error ? null : (
          <p className="m-0 text-secondary">Loading…</p>
        )
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-100 rounded-300 border border-line-card bg-surface-secondary py-1200 text-center">
          <PackageIcon aria-hidden="true" size={24} strokeWidth={2} className="text-icon-muted" />
          <p className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground">
            No negative stock
          </p>
          <p className="m-0 text-secondary">Every product has stock of zero or more.</p>
        </div>
      ) : (
        <Table
          className="table-fixed"
          aria-label="Negative stock"
          aria-busy={loadedKey !== requestKey(page, reloadKey)}
        >
          <colgroup>
            <col />
            <col className="w-[144px]" />
            <col className="w-[160px]" />
            <col className="w-[216px]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Stock value</TableHead>
              <TableHead>Last movement</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody ref={bodyRef}>
            {items.map((item, index) => (
              <TableRow
                key={item.id}
                tabIndex={index === activeIndex ? 0 : -1}
                aria-selected={index === activeIndex}
                className="cursor-pointer outline-none focus-visible:shadow-focus"
                onFocus={() => setActiveIndex(index)}
                onClick={() => openHistory(index)}
                onKeyDown={(event) => onRowKeyDown(event, index)}
              >
                <TableCell className="py-100">
                  <ProductNameCell item={item} />
                </TableCell>
                <TableCell className={`text-right tabular-nums ${negativeClass(item.onHandMilli)}`}>
                  {onHandText(item.onHandMilli, item.unit)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${negativeClass(item.stockValuePaisa)}`}
                >
                  {signedRupees(item.stockValuePaisa)}
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatDateTime(item.lastMovementAt)}
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
