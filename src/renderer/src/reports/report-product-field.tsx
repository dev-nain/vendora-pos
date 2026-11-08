import { useCallback, useRef, useState, type KeyboardEvent } from "react";

import { Input } from "@renderer/components/ui/input";
import { isSessionError } from "../auth/messages";
import { useDebouncedValue } from "../billing/scan-field";
import type { OrderProduct } from "../purchasing/order-form";
import { ProductPicker, type ProductPickerHandle } from "../purchasing/product-picker";

const SEARCH_DEBOUNCE_MS = 150;

interface ReportProductFieldProps {
  onChange: (productId: string | null) => void;
  onSessionEnded: () => void;
}

export function ReportProductField({ onChange, onSessionEnded }: ReportProductFieldProps) {
  const [text, setText] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [hasResults, setHasResults] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<ProductPickerHandle>(null);
  const query = useDebouncedValue(text, SEARCH_DEBOUNCE_MS);

  const pick = useCallback(
    (product: OrderProduct) => {
      setText(product.nameEn);
      setPickedId(product.id);
      onChange(product.id);
      inputRef.current?.focus();
    },
    [onChange],
  );

  const edit = (next: string) => {
    setText(next);
    if (pickedId !== null) {
      setPickedId(null);
      onChange(null);
    }
  };

  const pickFirstMatch = () => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    window.vendora.inventory
      .listStock({ query: trimmed, limit: 1, offset: 0 })
      .then((result) => {
        const item = result.items[0];
        if (item) {
          pick({
            id: item.id,
            nameEn: item.nameEn,
            nameUr: item.nameUr,
            unit: item.unit,
            costPaisa: item.costPaisa,
          });
        }
      })
      .catch((cause: unknown) => {
        if (isSessionError(cause)) onSessionEnded();
      });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && hasResults && pickedId === null) {
      event.preventDefault();
      pickerRef.current?.focusFirst();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (pickedId === null) pickFirstMatch();
    }
  };

  return (
    <div className="relative w-[320px]">
      <Input
        ref={inputRef}
        aria-label="Product"
        placeholder="Search or scan a product"
        autoComplete="off"
        value={text}
        onChange={(event) => edit(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <ProductPicker
        ref={pickerRef}
        query={query}
        visible={text.trim() !== "" && pickedId === null}
        onPick={pick}
        onReturnToScan={() => inputRef.current?.focus()}
        onResultsChange={setHasResults}
        onSessionEnded={onSessionEnded}
      />
    </div>
  );
}
