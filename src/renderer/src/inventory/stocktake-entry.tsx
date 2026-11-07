import { CircleCheckIcon } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";

import type { StocktakeLine } from "@shared/stocktake";
import { Button } from "@renderer/components/ui/button";
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { Kbd } from "@renderer/components/ui/kbd";
import { formatTime } from "../lib/date-time";
import { AdornedInput } from "../products/barcode-rows";
import { onHandText } from "./stock-format";

export interface EntryState {
  token: number;
  line: StocktakeLine;
  hint: string | null;
  initialText: string;
  text: string;
  error: string | null;
  pending: boolean;
}

const unitFieldLabel = {
  piece: "Counted (pcs)",
  kg: "Counted (kg)",
  litre: "Counted (L)",
} as const;
const unitTrail = { piece: "pcs", kg: "kg", litre: "L" } as const;

interface StocktakeEntryProps {
  entry: EntryState | null;
  saved: string | null;
  onTextChange: (text: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export function StocktakeEntry({
  entry,
  saved,
  onTextChange,
  onSave,
  onClose,
}: StocktakeEntryProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onClose();
  };

  return (
    <div className="h-[104px] overflow-hidden rounded-300 border border-line-card bg-surface-secondary px-400 py-200">
      {entry === null ? (
        saved ? (
          <p
            role="status"
            className="m-0 flex items-center gap-200 text-[length:var(--font-size-350)] text-success"
          >
            <CircleCheckIcon
              aria-hidden="true"
              size={16}
              strokeWidth={2}
              className="shrink-0 text-[var(--color-icon-success)]"
            />
            {saved}
          </p>
        ) : (
          <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
            Scan a barcode or pick a row, then enter the counted quantity.
          </p>
        )
      ) : (
        <form
          key={entry.token}
          noValidate
          className="flex items-start justify-between gap-400"
          onSubmit={submit}
          onKeyDown={onKeyDown}
        >
          <div className="grid min-w-0 gap-0">
            <p className="m-0 truncate text-[length:var(--font-size-450)] leading-[24px] font-semibold text-foreground">
              {entry.line.nameEn}
            </p>
            {entry.line.nameUr ? (
              <p
                lang="ur"
                dir="rtl"
                className="m-0 truncate font-urdu text-[length:var(--font-size-350)] leading-[var(--line-height-urdu)] text-secondary"
              >
                {entry.line.nameUr}
              </p>
            ) : null}
            <p className="m-0 truncate text-[length:var(--font-size-350)] text-secondary">
              On hand {onHandText(entry.line.onHandMilli, entry.line.unit)}
              {entry.line.countedMilli !== null && entry.line.countedAt
                ? `. Counted ${onHandText(entry.line.countedMilli, entry.line.unit)} at ${formatTime(entry.line.countedAt)}. Saving replaces it.`
                : null}
            </p>
            {entry.hint ? (
              <p className="m-0 truncate text-[length:var(--font-size-350)] font-semibold text-foreground">
                {entry.hint}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-start gap-300">
            <Field
              invalid={entry.error !== null}
              className="grid-cols-[auto_160px] items-center gap-x-200 gap-y-100"
            >
              <FieldLabel>{unitFieldLabel[entry.line.unit]}</FieldLabel>
              <AdornedInput
                name="counted"
                autoFocus
                inputMode="decimal"
                autoComplete="off"
                maxLength={16}
                trail={unitTrail[entry.line.unit]}
                className="text-right tabular-nums"
                value={entry.text}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => onTextChange(event.target.value)}
              />
              {entry.error ? <FieldError className="col-start-2">{entry.error}</FieldError> : null}
            </Field>
            <Button type="submit" disabled={entry.pending}>
              Save
              <Kbd>Enter</Kbd>
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
