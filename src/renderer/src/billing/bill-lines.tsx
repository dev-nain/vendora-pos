import { PackageCheckIcon, PackageXIcon, ScanBarcodeIcon } from "lucide-react";
import { useEffect, type ChangeEvent, type KeyboardEvent } from "react";

import type { BillLine } from "@shared/checkout";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import { cn } from "@renderer/lib/utils";
import { AdornedInput } from "../products/barcode-rows";
import { discountText, isWeighedLine, lineDetail, signedRupees } from "./bill-format";
import type { DiscountKind } from "./discount-input";
import type { FieldState, NumpadMode } from "./numpad-entry";

export interface LineEditing {
  mode: NumpadMode;
  field: FieldState;
  discountKind: DiscountKind;
  error: string | null;
}

interface BillLinesProps {
  lines: BillLine[];
  selectedId: string | null;
  editing: LineEditing | null;
  returningFrom: string | null;
  onSelect: (lineId: string) => void;
  onSetDamaged: (line: BillLine, damaged: boolean) => void;
  onFieldChange: (text: string) => void;
  onFieldKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

const optionId = (lineId: string) => `bill-line-${lineId}`;

const editorLabels: Record<NumpadMode, string> = {
  qty: "Quantity",
  discount: "Discount",
  price: "Price",
};

function LineEditor({
  line,
  editing,
  onChange,
  onKeyDown,
}: {
  line: BillLine;
  editing: LineEditing;
  onChange: (text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const { mode, field, discountKind, error } = editing;
  const adornment =
    mode === "price"
      ? { lead: "Rs" }
      : mode === "discount"
        ? discountKind === "percent"
          ? { trail: "%" }
          : { lead: "Rs" }
        : isWeighedLine(line)
          ? { trail: line.unit === "kg" ? "kg" : "L" }
          : {};
  return (
    <div className="grid justify-items-start gap-100" onClick={(event) => event.stopPropagation()}>
      <AdornedInput
        autoFocus
        aria-label={editorLabels[mode]}
        aria-invalid={error !== null}
        inputMode="decimal"
        autoComplete="off"
        maxLength={16}
        className="w-[140px] text-right tabular-nums"
        value={field.text}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        {...adornment}
      />
      {error ? (
        <span role="alert" className="text-[length:var(--font-size-300)] text-critical">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function Row({
  line,
  selected,
  editing,
  onSelect,
  onSetDamaged,
  onFieldChange,
  onFieldKeyDown,
}: {
  line: BillLine;
  selected: boolean;
  editing: LineEditing | null;
  onSelect: (lineId: string) => void;
  onSetDamaged: (line: BillLine, damaged: boolean) => void;
  onFieldChange: (text: string) => void;
  onFieldKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <div
      id={optionId(line.id)}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onMouseDown={(event) => {
        if (!(event.target as HTMLElement).closest("input")) event.preventDefault();
      }}
      onClick={() => onSelect(line.id)}
      className={cn(
        "flex min-h-[var(--height-row)] cursor-pointer items-center justify-between gap-300 px-600 py-200",
        selected ? "selection-pill" : "hover:bg-surface-hover",
      )}
    >
      <div className="grid min-w-0 gap-050">
        <span className="truncate text-[length:var(--font-size-400)] font-semibold text-foreground">
          {line.name}
        </span>
        {line.nameUr ? (
          <span
            lang="ur"
            dir="rtl"
            className="truncate text-left font-urdu text-[length:var(--font-size-350)] leading-[var(--line-height-urdu)] text-secondary"
          >
            {line.nameUr}
          </span>
        ) : null}
        {selected && editing && editing.mode !== "discount" ? (
          <LineEditor
            line={line}
            editing={editing}
            onChange={onFieldChange}
            onKeyDown={onFieldKeyDown}
          />
        ) : (
          <span className="flex flex-wrap items-center gap-x-200 text-[length:var(--font-size-300)] text-secondary">
            {line.isReturn ? <Badge variant="critical">Return</Badge> : null}
            <span>{lineDetail(line)}</span>
            {selected && editing ? null : line.discount ? (
              <span className="text-critical tabular-nums">{discountText(line.discount)}</span>
            ) : null}
          </span>
        )}
        {selected && editing?.mode === "discount" ? (
          <LineEditor
            line={line}
            editing={editing}
            onChange={onFieldChange}
            onKeyDown={onFieldKeyDown}
          />
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-300">
        {line.isReturn && !line.isMisc ? (
          <Button
            variant="secondary"
            aria-pressed={line.isDamaged}
            onClick={(event) => {
              event.stopPropagation();
              onSetDamaged(line, !line.isDamaged);
            }}
          >
            {line.isDamaged ? (
              <PackageXIcon aria-hidden="true" size={16} strokeWidth={2} />
            ) : (
              <PackageCheckIcon aria-hidden="true" size={16} strokeWidth={2} />
            )}
            {line.isDamaged ? "Damaged" : "Back to shelf"}
            {selected ? <Kbd>Ctrl+D</Kbd> : null}
          </Button>
        ) : null}
        <span
          className={cn(
            "text-[length:var(--font-size-400)] font-semibold tabular-nums",
            line.totalPaisa < 0 ? "text-critical" : "text-foreground",
          )}
        >
          {signedRupees(line.totalPaisa)}
        </span>
      </div>
    </div>
  );
}

export function BillLines({
  lines,
  selectedId,
  editing,
  returningFrom,
  onSelect,
  onSetDamaged,
  onFieldChange,
  onFieldKeyDown,
}: BillLinesProps) {
  useEffect(() => {
    if (selectedId) {
      document.getElementById(optionId(selectedId))?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedId]);

  if (lines.length === 0) {
    return (
      <div className="grid min-h-0 flex-1 place-content-center justify-items-center gap-200 text-secondary">
        <ScanBarcodeIcon
          aria-hidden="true"
          size={24}
          strokeWidth={2}
          className="text-[var(--color-icon-secondary)]"
        />
        <p className="m-0">Scan an item or pick one on the left.</p>
      </div>
    );
  }

  return (
    <>
      {returningFrom ? (
        <p className="m-0 px-600 pt-300 text-[length:var(--font-size-350)] text-secondary tabular-nums">
          Returning from {returningFrom}
        </p>
      ) : null}
      <div
        role="listbox"
        aria-label="Bill lines"
        aria-activedescendant={selectedId ? optionId(selectedId) : undefined}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {lines.map((line) => (
          <Row
            key={line.id}
            line={line}
            selected={line.id === selectedId}
            editing={editing}
            onSelect={onSelect}
            onSetDamaged={onSetDamaged}
            onFieldChange={onFieldChange}
            onFieldKeyDown={onFieldKeyDown}
          />
        ))}
      </div>
    </>
  );
}
