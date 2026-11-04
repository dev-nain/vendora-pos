import { useState, type FormEvent, type RefObject } from "react";

import type { ProductUnit } from "@shared/products";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { Kbd } from "@renderer/components/ui/kbd";
import { AdornedInput } from "../products/barcode-rows";
import { weightPreview } from "./weight-total";

export interface WeighedProduct {
  id: string;
  name: string;
  nameUr: string | null;
  unit: Exclude<ProductUnit, "piece">;
  unitPricePaisa: number;
}

interface WeightDialogProps {
  product: WeighedProduct;
  initialText: string;
  returnFocus: RefObject<HTMLElement | null>;
  onSubmit: (qtyMilli: number) => void;
  onCancel: () => void;
}

export function WeightDialog({
  product,
  initialText,
  returnFocus,
  onSubmit,
  onCancel,
}: WeightDialogProps) {
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const unitName = product.unit === "kg" ? "kg" : "L";
  const preview = weightPreview(text, product.unit, product.unitPricePaisa);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!preview.ok) {
      setError("Enter a weight above 0, up to 3 decimals.");
      return;
    }
    onSubmit(preview.qtyMilli);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent finalFocus={returnFocus}>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{product.name}</DialogTitle>
            {product.nameUr ? (
              <p
                lang="ur"
                dir="rtl"
                className="m-0 font-urdu text-[length:var(--font-size-350)] leading-[var(--line-height-urdu)] text-secondary"
              >
                {product.nameUr}
              </p>
            ) : null}
            <Field invalid={error !== null}>
              <FieldLabel>{product.unit === "kg" ? "Weight (kg)" : "Volume (L)"}</FieldLabel>
              <AdornedInput
                name="weight"
                autoFocus
                inputMode="decimal"
                autoComplete="off"
                maxLength={16}
                trail={unitName}
                className="text-right tabular-nums"
                value={text}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  setText(event.target.value);
                  setError(null);
                }}
              />
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
            <p
              aria-live="polite"
              className="m-0 min-h-[24px] text-[length:var(--font-size-450)] font-semibold text-foreground tabular-nums"
            >
              {preview.ok ? preview.text : ""}
            </p>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
              <Kbd>Esc</Kbd>
            </Button>
            <Button type="submit">
              Add
              <Kbd>Enter</Kbd>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
