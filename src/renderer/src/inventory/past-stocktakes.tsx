import { BanIcon, ChevronLeftIcon, ChevronRightIcon, CircleCheckIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { stocktakeScopeLabel, type PastStocktakesResult } from "@shared/stocktake";
import { Badge } from "@renderer/components/ui/badge";
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
import { formatDateTime } from "../lib/date-time";
import { PRODUCT_PAGE_SIZE, pageRangeLabel } from "../products/product-list";
import { ErrorLine } from "../users/form-parts";

interface PastStocktakesProps {
  onOpen: (stocktakeId: string) => void;
  onSessionEnded: () => void;
}

type PastItem = PastStocktakesResult["items"][number];

function StatusBadge({ status }: { status: PastItem["status"] }) {
  const posted = status === "posted";
  const Icon = posted ? CircleCheckIcon : BanIcon;
  return (
    <Badge variant={posted ? "success" : "neutral"}>
      <Icon aria-hidden="true" strokeWidth={2} />
      {posted ? "Posted" : "Cancelled"}
    </Badge>
  );
}

export function PastStocktakes({ onOpen, onSessionEnded }: PastStocktakesProps) {
  const [page, setPage] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [result, setResult] = useState<PastStocktakesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const requestId = useRef(0);

  const load = useCallback(() => {
    const id = ++requestId.current;
    window.vendora.stocktake
      .listPast({ limit: PRODUCT_PAGE_SIZE, offset: page * PRODUCT_PAGE_SIZE })
      .then((fetched) => {
        if (id !== requestId.current) return;
        setResult(fetched);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        if (isSessionError(cause)) onSessionEnded();
        else setError(serviceErrorMessage);
      });
  }, [page, onSessionEnded]);

  useEffect(() => {
    load();
  }, [load]);

  const items = result?.items ?? [];
  const total = result?.total ?? 0;
  const active = Math.min(activeIndex, Math.max(items.length - 1, 0));

  const focusRow = (index: number) => {
    setActiveIndex(index);
    bodyRef.current?.querySelectorAll<HTMLElement>("tr")[index]?.focus();
  };

  const onRowKeyDown = (event: ReactKeyboardEvent<HTMLTableRowElement>, index: number) => {
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
    const item = items[index];
    if (target !== null) {
      event.preventDefault();
      focusRow(target);
    } else if (event.key === "Enter" && item) {
      event.preventDefault();
      onOpen(item.id);
    }
  };

  const changePage = (next: number) => {
    setPage(next);
    setActiveIndex(0);
  };

  return (
    <section className="mt-600 grid gap-300">
      <h2 className="m-0 font-display text-[length:var(--font-size-450)] font-semibold text-foreground">
        Past counts
      </h2>
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
          <p className="m-0 text-secondary">Loading…</p>
        )
      ) : items.length === 0 ? (
        <p className="m-0 text-secondary">No past counts yet.</p>
      ) : (
        <Table className="table-fixed" aria-label="Past counts">
          <colgroup>
            <col className="w-[220px]" />
            <col />
            <col className="w-[160px]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody ref={bodyRef}>
            {items.map((item, index) => (
              <TableRow
                key={item.id}
                tabIndex={index === active ? 0 : -1}
                aria-selected={index === active}
                className="cursor-pointer outline-none focus-visible:shadow-focus"
                onFocus={() => setActiveIndex(index)}
                onClick={() => onOpen(item.id)}
                onKeyDown={(event) => onRowKeyDown(event, index)}
              >
                <TableCell>{formatDateTime(item.date)}</TableCell>
                <TableCell className="truncate">
                  {stocktakeScopeLabel(item.scope, item.categoryName)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={item.status} />
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
              onClick={() => changePage(page - 1)}
            >
              <ChevronLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={(page + 1) * PRODUCT_PAGE_SIZE >= total}
              focusableWhenDisabled
              onClick={() => changePage(page + 1)}
            >
              Next
              <ChevronRightIcon aria-hidden="true" size={16} strokeWidth={2} />
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
