import { AlertCircleIcon, SearchIcon } from "lucide-react";
import { useEffect, useState, type KeyboardEvent, type Ref } from "react";

import { Input } from "@renderer/components/ui/input";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

interface ScanFieldProps {
  ref?: Ref<HTMLInputElement>;
  value: string;
  notice: string | null;
  canMoveToGrid: boolean;
  onChange: (value: string) => void;
  onSubmit: (text: string) => void;
  onMoveToGrid: () => void;
  onDismissNotice: () => void;
}

export function ScanField({
  ref,
  value,
  notice,
  canMoveToGrid,
  onChange,
  onSubmit,
  onMoveToGrid,
  onDismissNotice,
}: ScanFieldProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      const text = value.trim();
      if (text === "") return;
      onChange("");
      onSubmit(text);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (value !== "") onChange("");
      else onDismissNotice();
    } else if (event.key === "ArrowDown" && value !== "" && canMoveToGrid) {
      event.preventDefault();
      onMoveToGrid();
    }
  };

  return (
    <div className="grid gap-100">
      <div className="relative">
        <SearchIcon
          aria-hidden="true"
          size={20}
          strokeWidth={2}
          className="pointer-events-none absolute top-1/2 left-300 -translate-y-1/2 text-icon-muted"
        />
        <Input
          id="scan-field"
          ref={ref}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          aria-label="Scan or search"
          placeholder="Scan or search (F2)"
          className="min-h-[var(--height-control-lg)] pl-[44px] text-[length:var(--font-size-450)]"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div role="status" aria-live="polite" className="min-h-[20px]">
        {notice ? (
          <p className="m-0 flex items-center gap-200 text-[length:var(--font-size-350)] text-critical">
            <AlertCircleIcon
              aria-hidden="true"
              size={16}
              strokeWidth={2}
              className="shrink-0 text-[var(--color-icon-critical)]"
            />
            {notice}
          </p>
        ) : null}
      </div>
    </div>
  );
}
