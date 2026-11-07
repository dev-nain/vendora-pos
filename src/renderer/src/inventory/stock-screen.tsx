import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PackageIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import type { StockListItem, StockListResult } from "@shared/inventory";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
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
import { signedRupees } from "../billing/bill-format";
import { BarcodeCell, ProductNameCell } from "../products/product-cells";
import {
  PRODUCT_PAGE_SIZE,
  emptyState,
  isTypingTarget,
  pageRangeLabel,
  unitLabel,
  type ProductFilters,
} from "../products/product-list";
import { ErrorLine } from "../users/form-parts";
import { StockAdjustDialog } from "./stock-adjust-dialog";
import { StockHistory } from "./stock-history";
import { negativeClass, onHandText } from "./stock-format";

const SEARCH_DEBOUNCE_MS = 150;
const ALL_CATEGORIES = "all";

interface StockScreenProps {
  onSessionEnded: () => void;
}

const dash = <span className="text-tertiary">—</span>;

const requestKey = (filters: ProductFilters, page: number, reloadKey: number): string =>
  JSON.stringify([filters, page, reloadKey]);

export function StockScreen({ onSessionEnded }: StockScreenProps) {
  const [searchText, setSearchText] = useState("");
  const [filters, setFilters] = useState<ProductFilters>({
    query: "",
    categoryId: null,
    showArchived: false,
  });
  const [page, setPage] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<StockListResult | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [adjustDialog, setAdjustDialog] = useState<{ item: StockListItem; open: boolean } | null>(
    null,
  );
  const [status, setStatus] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const requestId = useRef(0);
  const restoreFocus = useRef(false);

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
    window.vendora.categories
      .list()
      .then((list) => setCategories(list))
      .catch(fail);
  }, [fail]);

  useEffect(() => {
    if (searchText === filters.query) return;
    const timer = setTimeout(() => {
      setFilters((current) => ({ ...current, query: searchText }));
      setPage(0);
      setActiveIndex(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText, filters.query]);

  useEffect(() => {
    const id = ++requestId.current;
    const key = requestKey(filters, page, reloadKey);
    window.vendora.inventory
      .listStock({
        query: filters.query,
        ...(filters.categoryId === null ? {} : { categoryId: filters.categoryId }),
        limit: PRODUCT_PAGE_SIZE,
        offset: page * PRODUCT_PAGE_SIZE,
      })
      .then((fetched) => {
        if (id !== requestId.current) return;
        setResult(fetched);
        setError(null);
        setLoadedKey(key);
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        setLoadedKey(key);
        fail(cause);
      });
  }, [filters, page, reloadKey, fail]);

  const items = result?.items ?? [];

  useLayoutEffect(() => {
    if (historyIndex !== null || !restoreFocus.current) return;
    restoreFocus.current = false;
    bodyRef.current?.querySelectorAll<HTMLElement>("tr")[activeIndex]?.focus();
  }, [historyIndex, activeIndex]);

  const changeFilters = (next: Partial<ProductFilters>) => {
    setFilters((current) => ({ ...current, ...next }));
    setPage(0);
    setActiveIndex(0);
  };

  const focusRow = (index: number) => {
    setActiveIndex(index);
    bodyRef.current?.querySelectorAll<HTMLElement>("tr")[index]?.focus();
  };

  const openHistory = (index: number) => {
    setActiveIndex(index);
    setHistoryIndex(index);
  };

  const openAdjust = (index: number) => {
    const item = items[index];
    if (!item) return;
    setActiveIndex(index);
    setStatus(null);
    setAdjustDialog({ item, open: true });
  };

  const closeHistory = () => {
    restoreFocus.current = true;
    setHistoryIndex(null);
  };

  useEffect(() => {
    if (historyIndex !== null) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (adjustDialog?.open) return;
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey || isTypingTarget(event.target)) return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [historyIndex, adjustDialog?.open]);

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
      openHistory(index);
    } else if (
      event.key.toLowerCase() === "a" &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      openAdjust(index);
    }
  };

  const historyItem = historyIndex === null ? undefined : items[historyIndex];
  if (historyIndex !== null && historyItem) {
    return (
      <StockHistory
        productId={historyItem.id}
        onBack={closeHistory}
        onSessionEnded={onSessionEnded}
      />
    );
  }

  const categoryNames = new Map(categories?.map((category) => [category.id, category.name]));
  const categoryItems = [
    { value: ALL_CATEGORIES, label: "All categories" },
    ...(categories ?? []).map((category) => ({ value: category.id, label: category.name })),
  ];

  const total = result?.total ?? 0;
  const empty = emptyState(filters);

  return (
    <div className="flex flex-col gap-500">
      <div className="grid gap-100">
        <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
          Stock
        </h1>
        <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
          Select a product and press Enter to see its movements, or A to adjust it.
        </p>
      </div>
      <div className="flex items-center gap-300">
        <div className="relative flex-1">
          <SearchIcon
            aria-hidden="true"
            size={16}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-300 -translate-y-1/2 text-icon-muted"
          />
          <Input
            ref={searchRef}
            type="search"
            aria-label="Search stock"
            placeholder="Name, Urdu, code or barcode"
            autoFocus
            maxLength={200}
            className="pl-[36px]"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && items.length > 0) {
                event.preventDefault();
                focusRow(0);
              }
            }}
          />
          {searchFocused ? null : (
            <Kbd className="pointer-events-none absolute top-1/2 right-300 -translate-y-1/2">/</Kbd>
          )}
        </div>
        <Select
          items={categoryItems}
          value={filters.categoryId ?? ALL_CATEGORIES}
          onValueChange={(next) => {
            if (typeof next !== "string") return;
            changeFilters({ categoryId: next === ALL_CATEGORIES ? null : next });
          }}
        >
          <SelectTrigger aria-label="Category" className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categoryItems.map((category) => (
              <SelectItem key={category.value} value={category.value}>
                {category.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p role="status" aria-live="polite" className="m-0 text-secondary empty:hidden">
        {status}
      </p>
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
            {empty.title}
          </p>
          <p className="m-0 text-secondary">{empty.text}</p>
        </div>
      ) : (
        <Table
          className="table-fixed"
          aria-label="Stock"
          aria-busy={loadedKey !== requestKey(filters, page, reloadKey)}
        >
          <colgroup>
            <col />
            <col className="w-[176px]" />
            <col className="w-[136px]" />
            <col className="w-[64px]" />
            <col className="w-[112px]" />
            <col className="w-[112px]" />
            <col className="w-[128px]" />
            <col className="w-[76px]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Barcode</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Average cost</TableHead>
              <TableHead className="text-right">Stock value</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody ref={bodyRef}>
            {items.map((item, index) => {
              const categoryName = categoryNames.get(item.categoryId);
              return (
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
                  <TableCell>
                    <BarcodeCell item={item} />
                  </TableCell>
                  <TableCell className="truncate" title={categoryName}>
                    {categoryName ?? dash}
                  </TableCell>
                  <TableCell>{unitLabel(item.unit)}</TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${negativeClass(item.onHandMilli)}`}
                  >
                    {onHandText(item.onHandMilli, item.unit)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {signedRupees(item.costPaisa)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${negativeClass(item.stockValuePaisa)}`}
                  >
                    {signedRupees(item.stockValuePaisa)}
                  </TableCell>
                  <TableCell className="py-100">
                    <Button
                      variant="ghost"
                      className="size-[var(--height-control-md)] p-0"
                      tabIndex={index === activeIndex ? 0 : -1}
                      aria-label={`Adjust stock for ${item.nameEn}`}
                      title="Adjust stock (A)"
                      onClick={(event) => {
                        event.stopPropagation();
                        openAdjust(index);
                      }}
                    >
                      <SlidersHorizontalIcon
                        aria-hidden="true"
                        size={16}
                        strokeWidth={2}
                        className="text-icon-muted"
                      />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
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
      {adjustDialog ? (
        <StockAdjustDialog
          item={adjustDialog.item}
          open={adjustDialog.open}
          onOpenChange={(open) =>
            setAdjustDialog((current) => (current ? { ...current, open } : null))
          }
          returnFocus={() =>
            bodyRef.current?.querySelectorAll<HTMLElement>("tr")[activeIndex] ?? null
          }
          onAdjusted={({ changed, onHandMilli }) => {
            const { nameEn, unit } = adjustDialog.item;
            setStatus(
              changed
                ? `${nameEn} on hand is now ${onHandText(onHandMilli, unit)}.`
                : `${nameEn} is already at ${onHandText(onHandMilli, unit)}. Nothing changed.`,
            );
            setReloadKey((key) => key + 1);
          }}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
    </div>
  );
}
