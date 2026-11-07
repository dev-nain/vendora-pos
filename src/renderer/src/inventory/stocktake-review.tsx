import {
  CircleCheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  InfoIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import {
  stocktakeReviewFilters,
  type StocktakeReview,
  type StocktakeReviewFilter,
  type StocktakeReviewLine,
} from "@shared/stocktake";
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
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { formatDateTime } from "../lib/date-time";
import { ProductNameCell, StatusBadge } from "../products/product-cells";
import { PRODUCT_PAGE_SIZE, pageRangeLabel } from "../products/product-list";
import { ErrorLine } from "../users/form-parts";
import { PostStocktakeDialog } from "./post-stocktake-dialog";
import { onHandText, signedQuantityText, signedValueText } from "./stock-format";

const filterLabels: Record<StocktakeReviewFilter, string> = {
  all: "All lines",
  variance: "With a variance",
  uncounted: "Not counted",
};
const filterItems = stocktakeReviewFilters.map((value) => ({ value, label: filterLabels[value] }));

const emptyFilterMessages: Record<Exclude<StocktakeReviewFilter, "all">, string> = {
  variance: "No variance found",
  uncounted: "Every line was counted",
};

const ESCAPE_GUARD_MS = 200;

interface StocktakeReviewProps {
  stocktakeId: string;
  onBack: () => void;
  onSessionEnded: () => void;
}

interface LinesPage {
  items: StocktakeReviewLine[];
  total: number;
}

const signClass = (value: number): string =>
  value < 0 ? "text-critical" : value > 0 ? "text-success" : "text-secondary";

const dash = (label: string) => (
  <>
    <span aria-hidden="true" className="text-tertiary">
      —
    </span>
    <span className="sr-only">{label}</span>
  </>
);

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

function Total({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-050">
      <span className="text-[length:var(--font-size-300)] text-secondary">{label}</span>
      <span className="text-[length:var(--font-size-450)] font-semibold tabular-nums">
        {children}
      </span>
    </div>
  );
}

function ValueTotal({ paisa }: { paisa: number | null }) {
  if (paisa === null) return <span className="text-secondary">{dash("Not valued")}</span>;
  return <span className={signClass(paisa)}>{signedValueText(paisa)}</span>;
}

export function StocktakeReviewScreen({
  stocktakeId,
  onBack,
  onSessionEnded,
}: StocktakeReviewProps) {
  const [review, setReview] = useState<StocktakeReview | null>(null);
  const [filter, setFilter] = useState<StocktakeReviewFilter>("all");
  const [page, setPage] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [result, setResult] = useState<LinesPage | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [postedMessage, setPostedMessage] = useState<string | null>(null);

  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const postRef = useRef<HTMLButtonElement>(null);
  const selectOpenRef = useRef(false);
  const ignoreEscapeUntil = useRef(0);
  const focusBack = useRef(false);
  const requestId = useRef(0);
  const reviewRequestId = useRef(0);

  const items = result?.items ?? [];
  const total = result?.total ?? 0;
  const active = Math.min(activeIndex, Math.max(items.length - 1, 0));
  const readOnly = review !== null && review.status !== "open";
  const canPost = review !== null && review.status === "open" && review.countedCount > 0;
  const currentKey = JSON.stringify([filter, page, reloadKey]);

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

  const loadReview = useCallback(() => {
    const id = ++reviewRequestId.current;
    window.vendora.stocktake
      .review(stocktakeId)
      .then((fetched) => {
        if (id !== reviewRequestId.current) return;
        if (!fetched.ok) {
          onBack();
          return;
        }
        setReview(fetched.review);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (id === reviewRequestId.current) fail(cause);
      });
  }, [stocktakeId, fail, onBack]);

  useEffect(() => {
    loadReview();
  }, [loadReview]);

  useEffect(() => {
    const id = ++requestId.current;
    const key = JSON.stringify([filter, page, reloadKey]);
    window.vendora.stocktake
      .reviewLines({
        stocktakeId,
        filter,
        limit: PRODUCT_PAGE_SIZE,
        offset: page * PRODUCT_PAGE_SIZE,
      })
      .then((fetched) => {
        if (id !== requestId.current) return;
        if (!fetched.ok) {
          onBack();
          return;
        }
        setResult({ items: fetched.items, total: fetched.total });
        setError(null);
        setLoadedKey(key);
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        setLoadedKey(key);
        fail(cause);
      });
  }, [stocktakeId, filter, page, reloadKey, fail, onBack]);

  useLayoutEffect(() => {
    if (!focusBack.current || !readOnly) return;
    focusBack.current = false;
    backRef.current?.focus();
  }, [readOnly]);

  useEffect(() => {
    if (posting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F12") {
        event.preventDefault();
        if (canPost) setPosting(true);
        return;
      }
      if (event.key !== "Escape") return;
      if (event.defaultPrevented || selectOpenRef.current) return;
      if (performance.now() < ignoreEscapeUntil.current) return;
      event.preventDefault();
      onBack();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [posting, canPost, onBack]);

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
    if (target === null) return;
    event.preventDefault();
    focusRow(target);
  };

  const changePage = (next: number) => {
    setPage(next);
    setActiveIndex(0);
  };

  const keepReviewing = () => {
    ignoreEscapeUntil.current = performance.now() + ESCAPE_GUARD_MS;
    setPosting(false);
  };

  const scopeText = review
    ? review.scope === "full"
      ? "Full count"
      : `Category: ${review.categoryName ?? ""}`
    : "";
  const subtitle = review
    ? review.status === "posted" && review.postedAt
      ? `${scopeText}. Posted ${formatDateTime(review.postedAt)} by ${review.postedByName ?? ""}.`
      : review.status === "cancelled"
        ? `${scopeText}. Started ${formatDateTime(review.startedAt)} by ${review.startedByName}. Cancelled, stock was not changed.`
        : `${scopeText}. Started ${formatDateTime(review.startedAt)} by ${review.startedByName}.`
    : "";

  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-400 gap-y-400">
      <div className="col-start-1 row-start-1 grid content-start gap-100">
        <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
          Stocktake
        </h1>
        <p className="m-0 text-[length:var(--font-size-350)] text-secondary">{subtitle}</p>
      </div>
      {review ? (
        <div className="col-span-2 grid gap-200">
          <div className="flex items-start gap-600 rounded-300 border border-line-card bg-surface-secondary px-400 py-300">
            <Total label="Counted">
              {review.countedCount} of {review.lineCount}
            </Total>
            <Total label="Not counted">{review.skippedCount}</Total>
            <Total label="With a variance">{review.varianceLineCount}</Total>
            <Total label="Short">
              <ValueTotal paisa={review.shortValuePaisa} />
            </Total>
            <Total label="Over">
              <ValueTotal paisa={review.surplusValuePaisa} />
            </Total>
            <Total label="Net">
              <ValueTotal paisa={review.netValuePaisa} />
            </Total>
          </div>
          {review.status === "open" && review.skippedCount > 0 ? (
            <p className="m-0 flex items-center gap-100 text-[length:var(--font-size-350)] text-secondary">
              <InfoIcon aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
              {plural(review.skippedCount, "line", "lines")} not counted. They stay unchanged.
            </p>
          ) : null}
          {review.status === "open" && review.countedCount === 0 ? (
            <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
              Count at least one product before posting.
            </p>
          ) : null}
          {postedMessage ? (
            <p
              role="status"
              className="m-0 flex items-center gap-100 text-[length:var(--font-size-350)] text-success"
            >
              <CircleCheckIcon aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
              {postedMessage}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="col-span-2">
        <Select
          items={filterItems}
          value={filter}
          onValueChange={(next) => {
            if (typeof next !== "string") return;
            setFilter(next as StocktakeReviewFilter);
            setPage(0);
            setActiveIndex(0);
          }}
          onOpenChange={(open) => {
            if (open) selectOpenRef.current = true;
            else {
              setTimeout(() => {
                selectOpenRef.current = false;
              }, 0);
            }
          }}
        >
          <SelectTrigger aria-label="Show" className="w-[240px]" autoFocus>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {filterItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error ? (
        <div className="col-span-2 flex items-center gap-300">
          <ErrorLine>{error}</ErrorLine>
          <Button
            variant="secondary"
            onClick={() => {
              setReloadKey((next) => next + 1);
              loadReview();
            }}
          >
            Try again
          </Button>
        </div>
      ) : null}
      <div className="col-span-2">
        {result === null ? (
          error ? null : (
            <p className="m-0 text-secondary">Loading…</p>
          )
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-100 rounded-300 border border-line-card bg-surface-secondary py-1200 text-center">
            <ClipboardListIcon
              aria-hidden="true"
              size={24}
              strokeWidth={2}
              className="text-icon-muted"
            />
            <p className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground">
              {filter === "all" ? "No lines in this count" : emptyFilterMessages[filter]}
            </p>
          </div>
        ) : (
          <Table className="table-fixed" aria-label="Variance" aria-busy={loadedKey !== currentKey}>
            <colgroup>
              <col />
              <col className="w-[120px]" />
              <col className="w-[120px]" />
              <col className="w-[120px]" />
              <col className="w-[150px]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Expected</TableHead>
                <TableHead className="text-right">Counted</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody ref={bodyRef}>
              {items.map((item, index) => (
                <TableRow
                  key={item.id}
                  tabIndex={index === active ? 0 : -1}
                  aria-selected={index === active}
                  className="outline-none focus-visible:shadow-focus"
                  onFocus={() => setActiveIndex(index)}
                  onKeyDown={(event) => onRowKeyDown(event, index)}
                >
                  <TableCell className="py-100">
                    <ProductNameCell item={item} />
                    {item.isActive ? null : <StatusBadge isActive={false} />}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.expectedMilli === null
                      ? dash("Not counted")
                      : onHandText(item.expectedMilli, item.unit)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.countedMilli === null
                      ? dash("Not counted")
                      : onHandText(item.countedMilli, item.unit)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      item.varianceMilli === null ? "" : signClass(item.varianceMilli)
                    }`}
                  >
                    {item.varianceMilli === null
                      ? dash("Not counted")
                      : signedQuantityText(item.varianceMilli, item.unit)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      item.varianceValuePaisa === null ? "" : signClass(item.varianceValuePaisa)
                    }`}
                  >
                    {item.varianceValuePaisa === null
                      ? dash(item.varianceMilli === null ? "Not counted" : "Not valued")
                      : signedValueText(item.varianceValuePaisa)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      {total > PRODUCT_PAGE_SIZE ? (
        <div className="col-span-2 flex items-center justify-between">
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
      <div className="col-start-2 row-start-1 flex items-start gap-200">
        <Button ref={backRef} type="button" variant="secondary" onClick={onBack}>
          {readOnly ? "Back" : "Back to count"}
          <Kbd>Esc</Kbd>
        </Button>
        {readOnly ? null : (
          <Button
            ref={postRef}
            type="button"
            disabled={!canPost}
            focusableWhenDisabled
            onClick={() => setPosting(true)}
          >
            Post adjustments
            <Kbd>F12</Kbd>
          </Button>
        )}
      </div>
      {posting && review ? (
        <PostStocktakeDialog
          stocktakeId={stocktakeId}
          adjustmentCount={review.varianceLineCount}
          skippedCount={review.skippedCount}
          netValuePaisa={review.netValuePaisa ?? 0}
          returnFocus={postRef}
          onPosted={(adjustmentCount) => {
            focusBack.current = true;
            setPosting(false);
            setPostedMessage(
              adjustmentCount === 0
                ? "Posted. No stock changed."
                : `Posted. ${plural(adjustmentCount, "adjustment", "adjustments")} written.`,
            );
            setReloadKey((next) => next + 1);
            loadReview();
          }}
          onClosed={() => {
            setPosting(false);
            setReloadKey((next) => next + 1);
            loadReview();
          }}
          onKeep={keepReviewing}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
    </div>
  );
}
