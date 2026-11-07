import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";

import type { StockListItem } from "@shared/inventory";
import { cn } from "@renderer/lib/utils";
import { isSessionError } from "../auth/messages";
import { formatQuantity } from "../lib/quantity";
import { ProductNameCell } from "../products/product-cells";
import type { OrderProduct } from "./order-form";

const PICKER_LIMIT = 8;

export interface ProductPickerHandle {
  focusFirst: () => void;
}

interface ProductPickerProps {
  ref?: Ref<ProductPickerHandle>;
  query: string;
  visible: boolean;
  onPick: (product: OrderProduct) => void;
  onReturnToScan: () => void;
  onResultsChange: (hasResults: boolean) => void;
  onSessionEnded: () => void;
}

const toOrderProduct = (item: StockListItem): OrderProduct => ({
  id: item.id,
  nameEn: item.nameEn,
  nameUr: item.nameUr,
  unit: item.unit,
  costPaisa: item.costPaisa,
});

export function ProductPicker({
  ref,
  query,
  visible,
  onPick,
  onReturnToScan,
  onResultsChange,
  onSessionEnded,
}: ProductPickerProps) {
  const [items, setItems] = useState<StockListItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    const trimmed = query.trim();
    if (trimmed === "") return;
    window.vendora.inventory
      .listStock({ query: trimmed, limit: PICKER_LIMIT, offset: 0 })
      .then((result) => {
        if (id !== requestId.current) return;
        setItems(result.items);
        setActiveIndex(0);
        onResultsChange(result.items.length > 0);
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        setItems([]);
        onResultsChange(false);
        if (isSessionError(cause)) onSessionEnded();
      });
  }, [query, onResultsChange, onSessionEnded]);

  const focusOption = (index: number) => {
    setActiveIndex(index);
    listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[index]?.focus();
  };

  useImperativeHandle(ref, () => ({ focusFirst: () => focusOption(0) }));

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(Math.min(index + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[index];
      if (item) onPick(toOrderProduct(item));
    } else if (event.key === "Escape") {
      event.preventDefault();
      onReturnToScan();
    }
  };

  if (!visible || items.length === 0) return null;

  return (
    <ul
      ref={listRef}
      role="listbox"
      aria-label="Matching products"
      className="absolute top-[calc(var(--height-control-lg)+4px)] right-0 left-0 z-20 m-0 grid list-none gap-050 rounded-300 border border-line-card bg-surface-secondary p-100 shadow-200"
    >
      {items.map((item, index) => (
        <li
          key={item.id}
          role="option"
          aria-selected={index === activeIndex}
          tabIndex={index === activeIndex ? 0 : -1}
          className={cn(
            "flex min-h-[var(--height-control-md)] cursor-pointer items-center justify-between gap-300 rounded-100 px-300 py-100 outline-none hover:bg-surface-hover focus-visible:shadow-focus",
            index === activeIndex && "bg-surface-selected",
          )}
          onClick={() => onPick(toOrderProduct(item))}
          onFocus={() => setActiveIndex(index)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          <span className="min-w-0 flex-1">
            <ProductNameCell item={item} />
          </span>
          <span className="shrink-0 text-[length:var(--font-size-350)] text-secondary tabular-nums">
            {formatQuantity(item.onHandMilli, item.unit)} on hand
          </span>
        </li>
      ))}
    </ul>
  );
}
