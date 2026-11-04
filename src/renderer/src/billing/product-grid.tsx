import { CheckIcon } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";

import { PRODUCT_SEARCH_MAX_LIMIT, type ProductSearchItem } from "@shared/products";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { formatRupees } from "../lib/money";
import { formatQuantity } from "../lib/quantity";
import { columnCount, gridHeight, pagesForRange, scrollTopFor, visibleRange } from "./grid-window";

const TILE_MIN_WIDTH = 168;
const TILE_HEIGHT = 96;
const GAP = 12;
const ROW_HEIGHT = TILE_HEIGHT + GAP;
const OVERSCAN_ROWS = 2;

export interface ProductGridHandle {
  focusFirst: () => void;
}

interface ProductGridProps {
  ref?: Ref<ProductGridHandle>;
  query: string;
  onAdd: (item: ProductSearchItem) => void;
  onReturnToScan: () => void;
  onResultsChange: (hasResults: boolean) => void;
  onSessionEnded: () => void;
}

interface Category {
  id: string;
  name: string;
}

interface Loaded {
  key: string;
  total: number;
  pages: Map<number, ProductSearchItem[]>;
}

function Tile({
  item,
  index,
  active,
  onAdd,
}: {
  item: ProductSearchItem | undefined;
  index: number;
  active: boolean;
  onAdd: (item: ProductSearchItem) => void;
}) {
  if (!item) {
    return (
      <div
        aria-hidden="true"
        data-index={index}
        className="h-[96px] rounded-300 border border-line-card bg-surface-hover"
      />
    );
  }
  return (
    <button
      type="button"
      data-index={index}
      tabIndex={active ? 0 : -1}
      onClick={() => onAdd(item)}
      className="grid h-[96px] min-h-[44px] content-between gap-100 rounded-300 border border-line-card bg-surface-secondary p-200 text-left outline-none hover:bg-surface-hover focus-visible:shadow-focus"
    >
      <span className="grid min-w-0 gap-050">
        <span
          title={item.nameEn}
          className={cn(
            "text-[length:var(--font-size-350)] leading-[var(--line-height-tight)] font-semibold text-foreground",
            item.nameUr ? "truncate" : "line-clamp-2",
          )}
        >
          {item.nameEn}
        </span>
        {item.nameUr ? (
          <span
            lang="ur"
            dir="rtl"
            className="truncate font-urdu text-[length:var(--font-size-350)] leading-[var(--line-height-urdu)] text-secondary"
          >
            {item.nameUr}
          </span>
        ) : null}
      </span>
      <span className="flex items-baseline justify-between gap-200">
        <span className="text-[length:var(--font-size-400)] font-semibold text-foreground tabular-nums">
          {formatRupees(item.salePricePaisa)}
        </span>
        <span className="truncate text-[length:var(--font-size-300)] text-tertiary tabular-nums">
          {formatQuantity(item.onHandMilli, item.unit)}
        </span>
      </span>
    </button>
  );
}

function ProductGridView({
  ref,
  query,
  onAdd,
  onReturnToScan,
  onResultsChange,
  onSessionEnded,
}: ProductGridProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [scroll, setScroll] = useState({ top: 0, width: 0, height: 0 });
  const [active, setActive] = useState({ key: "", index: 0 });
  const viewport = useRef<HTMLDivElement | null>(null);
  const requested = useRef(new Set<string>());
  const pendingFocus = useRef(false);
  const latestKey = useRef("");

  const key = JSON.stringify([query, categoryId]);
  const activeIndex = active.key === key ? active.index : 0;

  const fail = useCallback(
    (cause: unknown) => {
      if (isSessionError(cause)) onSessionEnded();
      else setFailed(true);
    },
    [onSessionEnded],
  );

  useEffect(() => {
    window.vendora.categories
      .list()
      .then(setCategories)
      .catch((cause: unknown) => {
        if (isSessionError(cause)) onSessionEnded();
      });
  }, [onSessionEnded]);

  const fetchPage = useCallback(
    (page: number, forKey: string) => {
      const requestKey = `${forKey}:${page}`;
      if (requested.current.has(requestKey)) return;
      requested.current.add(requestKey);
      const [text, category] = JSON.parse(forKey) as [string, string | null];
      window.vendora.products
        .search({
          query: text,
          ...(category === null ? {} : { categoryId: category }),
          limit: PRODUCT_SEARCH_MAX_LIMIT,
          offset: page * PRODUCT_SEARCH_MAX_LIMIT,
        })
        .then((result) => {
          if (forKey !== latestKey.current) return;
          setFailed(false);
          setLoaded((current) => {
            const pages = new Map(current?.key === forKey ? current.pages : []);
            pages.set(page, result.items);
            return { key: forKey, total: result.total, pages };
          });
        })
        .catch((cause: unknown) => {
          requested.current.delete(requestKey);
          fail(cause);
        });
    },
    [fail],
  );

  useEffect(() => {
    requested.current = new Set();
    latestKey.current = key;
    if (viewport.current) viewport.current.scrollTop = 0;
    fetchPage(0, key);
  }, [key, fetchPage]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () =>
      setScroll((current) => ({
        ...current,
        width: element.clientWidth,
        height: element.clientHeight,
      }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const current = loaded?.key === key ? loaded : null;
  const total = current?.total ?? 0;
  const columns = columnCount(scroll.width, TILE_MIN_WIDTH, GAP);
  const range = visibleRange({
    scrollTop: scroll.top,
    viewportHeight: scroll.height,
    rowHeight: ROW_HEIGHT,
    columns,
    total,
    overscanRows: OVERSCAN_ROWS,
  });
  const { start: rangeStart, end: rangeEnd } = range;

  useEffect(() => {
    if (!current) return;
    for (const page of pagesForRange(
      { start: rangeStart, end: rangeEnd },
      PRODUCT_SEARCH_MAX_LIMIT,
    )) {
      if (!current.pages.has(page)) fetchPage(page, key);
    }
  }, [current, rangeStart, rangeEnd, key, fetchPage]);

  useEffect(() => {
    onResultsChange(total > 0);
  }, [total, onResultsChange]);

  const itemAt = (index: number): ProductSearchItem | undefined =>
    current?.pages.get(Math.floor(index / PRODUCT_SEARCH_MAX_LIMIT))?.[
      index % PRODUCT_SEARCH_MAX_LIMIT
    ];

  const focusIndex = useCallback(
    (index: number) => {
      const element = viewport.current;
      if (!element || total === 0) return;
      const target = Math.min(Math.max(index, 0), total - 1);
      pendingFocus.current = true;
      setActive({ key, index: target });
      const top = scrollTopFor(
        target,
        { scrollTop: element.scrollTop, viewportHeight: element.clientHeight },
        { rowHeight: ROW_HEIGHT, columns, gap: GAP },
      );
      if (top !== element.scrollTop) {
        element.scrollTop = top;
        setScroll((state) => ({ ...state, top }));
      }
    },
    [total, columns, key],
  );

  useEffect(() => {
    if (!pendingFocus.current) return;
    const tile = viewport.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    if (tile && tile.tagName === "BUTTON") {
      pendingFocus.current = false;
      tile.focus();
    }
  });

  useImperativeHandle(ref, () => ({ focusFirst: () => focusIndex(0) }), [focusIndex]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const index = Number((event.target as HTMLElement).dataset.index);
    if (Number.isNaN(index)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onReturnToScan();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focusIndex(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusIndex(index - 1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusIndex(Math.min(index + columns, total - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index < columns) onReturnToScan();
      else focusIndex(index - columns);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusIndex(total - 1);
    }
  };

  const tiles = Array.from({ length: range.end - range.start }, (_, offset) => {
    const index = range.start + offset;
    return (
      <Tile
        key={index}
        item={itemAt(index)}
        index={index}
        active={index === activeIndex}
        onAdd={onAdd}
      />
    );
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-300">
      <div
        role="group"
        aria-label="Categories"
        className="flex min-w-0 gap-200 overflow-x-auto pb-100"
      >
        {[{ id: null, name: "All" }, ...categories].map((category) => {
          const selected = category.id === categoryId;
          return (
            <Button
              key={category.id ?? "all"}
              variant="secondary"
              aria-pressed={selected}
              className={cn("min-h-[44px] shrink-0 rounded-100", selected && "bg-surface-selected")}
              onClick={() => setCategoryId(category.id)}
            >
              {selected ? <CheckIcon aria-hidden="true" size={16} strokeWidth={2} /> : null}
              {category.name}
            </Button>
          );
        })}
      </div>
      <div
        ref={viewport}
        role="region"
        aria-label="Products"
        onScroll={(event) => {
          const top = event.currentTarget.scrollTop;
          setScroll((state) => (state.top === top ? state : { ...state, top }));
        }}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      >
        {failed ? (
          <p role="alert" className="m-0 text-critical">
            {serviceErrorMessage}
          </p>
        ) : current && total === 0 ? (
          <p className="m-0 text-secondary">
            {query.trim() === "" ? "No products to show." : `No products match '${query.trim()}'`}
          </p>
        ) : (
          <div style={{ height: gridHeight(total, columns, ROW_HEIGHT, GAP) }} className="relative">
            <div
              style={{
                top: Math.floor(range.start / columns) * ROW_HEIGHT,
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              }}
              className="absolute right-0 left-0 grid gap-300"
            >
              {tiles}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const ProductGrid = memo(ProductGridView);
