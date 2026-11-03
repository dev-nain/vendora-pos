import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PackageIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { ProductSearchItem, ProductSearchResult } from "@shared/products";
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
import { formatRupees } from "../lib/money";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { ErrorLine } from "../users/form-parts";
import { DeleteProductDialog } from "./delete-product-dialog";
import { BarcodeCell, ProductNameCell, StatusBadge } from "./product-cells";
import {
  PRODUCT_PAGE_SIZE,
  emptyState,
  fetchProductPage,
  isTypingTarget,
  pageRangeLabel,
  unitLabel,
  type ProductFilters,
} from "./product-list";
import { ProductRowMenu } from "./product-row-menu";

const SEARCH_DEBOUNCE_MS = 150;
const ALL_CATEGORIES = "all";

interface ProductsScreenProps {
  onSessionEnded: () => void;
  onOpenProduct?: (productId: string | null) => void;
}

interface DeleteDialogState {
  item: ProductSearchItem;
  open: boolean;
}

const requestKey = (filters: ProductFilters, page: number, reloadKey: number): string =>
  JSON.stringify([filters, page, reloadKey]);

const dash = <span className="text-tertiary">—</span>;

export function ProductsScreen({ onSessionEnded, onOpenProduct }: ProductsScreenProps) {
  const [searchText, setSearchText] = useState("");
  const [filters, setFilters] = useState<ProductFilters>({
    query: "",
    categoryId: null,
    showArchived: false,
  });
  const [page, setPage] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<ProductSearchResult | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const requestId = useRef(0);
  const focusAfterLoad = useRef(false);

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
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText, filters.query]);

  useEffect(() => {
    const id = ++requestId.current;
    const key = requestKey(filters, page, reloadKey);
    fetchProductPage(window.vendora.products.search, filters, page)
      .then((fetched) => {
        if (id !== requestId.current) return;
        setResult(fetched.result);
        setError(null);
        setLoadedKey(key);
        if (fetched.page !== page) setPage(fetched.page);
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        setLoadedKey(key);
        fail(cause);
      });
  }, [filters, page, reloadKey, fail]);

  const items = result?.items ?? [];

  useEffect(() => {
    if (!result || !focusAfterLoad.current) return;
    focusAfterLoad.current = false;
    const index = Math.max(Math.min(activeIndex, result.items.length - 1), 0);
    setActiveIndex(index);
    bodyRef.current?.querySelectorAll<HTMLElement>("tr")[index]?.focus();
  }, [result, activeIndex]);

  const reload = (keepFocus: boolean) => {
    focusAfterLoad.current = keepFocus;
    setReloadKey((key) => key + 1);
  };

  const changeFilters = (next: Partial<ProductFilters>) => {
    setFilters((current) => ({ ...current, ...next }));
    setPage(0);
    setActiveIndex(0);
  };

  const focusRow = (index: number) => {
    setActiveIndex(index);
    bodyRef.current?.querySelectorAll<HTMLElement>("tr")[index]?.focus();
  };

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey || deleteDialog !== null) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key.toLowerCase() === "n" && onOpenProduct) {
        event.preventDefault();
        onOpenProduct(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteDialog, onOpenProduct]);

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
    } else if (event.key === "Enter" && onOpenProduct) {
      event.preventDefault();
      const item = items[index];
      if (item) onOpenProduct(item.id);
    }
  };

  const toggleArchive = async (item: ProductSearchItem) => {
    try {
      const outcome = item.isActive
        ? await window.vendora.products.archive(item.id)
        : await window.vendora.products.restore(item.id);
      if (outcome.ok) {
        setError(null);
        setStatus(`${item.isActive ? "Archived" : "Restored"} ${item.nameEn}.`);
      } else {
        setStatus(null);
        setError(outcome.message);
      }
      if (outcome.ok || outcome.reason === "not-found") reload(true);
    } catch (cause) {
      fail(cause);
    }
  };

  const categoryNames = new Map(categories?.map((category) => [category.id, category.name]));
  const categoryItems = [
    { value: ALL_CATEGORIES, label: "All categories" },
    ...(categories ?? []).map((category) => ({ value: category.id, label: category.name })),
  ];

  const total = result?.total ?? 0;
  const showEmpty = result !== null && items.length === 0;
  const empty = emptyState(filters);

  return (
    <div className="flex flex-col gap-500">
      <div className="grid gap-100">
        <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
          Products
        </h1>
        <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
          Find a product by name, Urdu name, code or barcode.
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
            aria-label="Search products"
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
        <Button
          variant="secondary"
          aria-pressed={filters.showArchived}
          onClick={() => changeFilters({ showArchived: !filters.showArchived })}
        >
          {filters.showArchived ? <CheckIcon aria-hidden="true" size={16} strokeWidth={2} /> : null}
          Show archived
        </Button>
        {onOpenProduct ? (
          <Button onClick={() => onOpenProduct(null)}>
            <PlusIcon aria-hidden="true" size={16} strokeWidth={2} />
            Add product
            <Kbd>N</Kbd>
          </Button>
        ) : null}
      </div>
      {error ? (
        <div className="flex items-center gap-300">
          <ErrorLine>{error}</ErrorLine>
          <Button variant="secondary" onClick={() => reload(false)}>
            Try again
          </Button>
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="m-0 text-secondary empty:hidden">
        {status}
      </p>
      {result === null ? (
        error ? null : (
          <p className="m-0 text-secondary">Loading products…</p>
        )
      ) : showEmpty ? (
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
          aria-label="Products"
          aria-busy={loadedKey !== requestKey(filters, page, reloadKey)}
        >
          <colgroup>
            <col />
            <col className="w-[112px]" />
            <col className="w-[184px]" />
            <col className="w-[152px]" />
            <col className="w-[72px]" />
            <col className="w-[112px]" />
            <col className="w-[112px]" />
            <col className="w-[64px]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Barcode</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Sale price</TableHead>
              <TableHead>Status</TableHead>
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
                  className="outline-none focus-visible:shadow-focus"
                  onFocus={() => setActiveIndex(index)}
                  onClick={() => setActiveIndex(index)}
                  onKeyDown={(event) => onRowKeyDown(event, index)}
                >
                  <TableCell className="py-100">
                    <ProductNameCell item={item} />
                  </TableCell>
                  <TableCell
                    className="truncate font-mono text-secondary"
                    title={item.internalCode ?? undefined}
                  >
                    {item.internalCode ?? dash}
                  </TableCell>
                  <TableCell>
                    <BarcodeCell item={item} />
                  </TableCell>
                  <TableCell className="truncate" title={categoryName}>
                    {categoryName ?? dash}
                  </TableCell>
                  <TableCell>{unitLabel(item.unit)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRupees(item.salePricePaisa)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge isActive={item.isActive} />
                  </TableCell>
                  <TableCell className="px-200">
                    <ProductRowMenu
                      item={item}
                      {...(onOpenProduct ? { onEdit: () => onOpenProduct(item.id) } : {})}
                      onToggleArchive={() => void toggleArchive(item)}
                      onDelete={() => setDeleteDialog({ item, open: true })}
                    />
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
      {deleteDialog ? (
        <DeleteProductDialog
          item={deleteDialog.item}
          open={deleteDialog.open}
          onOpenChange={(open) =>
            setDeleteDialog((current) => (current ? { ...current, open } : null))
          }
          onDeleted={() => reload(true)}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
    </div>
  );
}
