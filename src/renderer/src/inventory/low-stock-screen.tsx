import { ChevronLeftIcon, ChevronRightIcon, PackageIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { LowStockResult } from "@shared/inventory";
import { Button } from "@renderer/components/ui/button";
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
import { ProductNameCell } from "../products/product-cells";
import { PRODUCT_PAGE_SIZE, pageRangeLabel } from "../products/product-list";
import { ErrorLine } from "../users/form-parts";
import { negativeClass, onHandText } from "./stock-format";

const ALL_CATEGORIES = "all";

interface LowStockScreenProps {
  onSessionEnded: () => void;
}

const dash = <span className="text-tertiary">—</span>;

const requestKey = (categoryId: string | null, page: number, reloadKey: number): string =>
  JSON.stringify([categoryId, page, reloadKey]);

export function LowStockScreen({ onSessionEnded }: LowStockScreenProps) {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<LowStockResult | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const requestId = useRef(0);

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
    const id = ++requestId.current;
    const key = requestKey(categoryId, page, reloadKey);
    window.vendora.inventory
      .lowStock({
        ...(categoryId === null ? {} : { categoryId }),
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
  }, [categoryId, page, reloadKey, fail]);

  const items = result?.items ?? [];

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
    }
  };

  const categoryNames = new Map(categories?.map((category) => [category.id, category.name]));
  const categoryItems = [
    { value: ALL_CATEGORIES, label: "All categories" },
    ...(categories ?? []).map((category) => ({ value: category.id, label: category.name })),
  ];

  const total = result?.total ?? 0;
  const empty =
    categoryId === null
      ? {
          title: "Nothing is low on stock",
          text: "Products appear here when they reach their low-stock threshold.",
        }
      : { title: "Nothing is low in this category", text: "Try another category." };

  return (
    <div className="flex flex-col gap-500">
      <div className="grid gap-100">
        <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
          Low stock
        </h1>
        <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
          Products at or below their low-stock threshold.
        </p>
      </div>
      <div className="flex items-center gap-300">
        <Select
          items={categoryItems}
          value={categoryId ?? ALL_CATEGORIES}
          onValueChange={(next) => {
            if (typeof next !== "string") return;
            setCategoryId(next === ALL_CATEGORIES ? null : next);
            setPage(0);
            setActiveIndex(0);
          }}
        >
          <SelectTrigger aria-label="Category" className="w-[200px]" autoFocus>
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
          aria-label="Low stock"
          aria-busy={loadedKey !== requestKey(categoryId, page, reloadKey)}
        >
          <colgroup>
            <col />
            <col className="w-[200px]" />
            <col className="w-[128px]" />
            <col className="w-[128px]" />
            <col className="w-[128px]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Threshold</TableHead>
              <TableHead className="text-right">Shortfall</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody ref={bodyRef}>
            {items.map((item, index) => {
              const categoryName = item.categoryId ? categoryNames.get(item.categoryId) : undefined;
              return (
                <TableRow
                  key={item.id}
                  tabIndex={index === activeIndex ? 0 : -1}
                  aria-selected={index === activeIndex}
                  className="outline-none focus-visible:shadow-focus"
                  onFocus={() => setActiveIndex(index)}
                  onKeyDown={(event) => onRowKeyDown(event, index)}
                >
                  <TableCell className="py-100">
                    <ProductNameCell item={item} />
                  </TableCell>
                  <TableCell className="truncate" title={categoryName}>
                    {categoryName ?? dash}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${negativeClass(item.onHandMilli)}`}
                  >
                    {onHandText(item.onHandMilli, item.unit)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {onHandText(item.thresholdMilli, item.unit)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {onHandText(item.shortfallMilli, item.unit)}
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
    </div>
  );
}
