import { PlusIcon, Trash2Icon } from "lucide-react";
import { useRef, type ComponentProps } from "react";

import type { ProductUnit } from "@shared/products";
import { Button } from "@renderer/components/ui/button";
import { Field, FieldError } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import { cn } from "@renderer/lib/utils";
import {
  MAX_BARCODE_ROWS,
  packPriceHint,
  type BarcodeColumn,
  type BarcodeRowValues,
  type ProductFormErrors,
} from "./product-form";
import { unitLabel } from "./product-list";

export function AdornedInput({
  lead,
  trail,
  className,
  ...props
}: ComponentProps<typeof Input> & { lead?: string; trail?: string }) {
  const adornment =
    "pointer-events-none absolute top-1/2 -translate-y-1/2 text-[length:var(--font-size-350)] text-tertiary";
  return (
    <div className="relative">
      {lead ? (
        <span aria-hidden="true" className={cn(adornment, "left-300")}>
          {lead}
        </span>
      ) : null}
      <Input className={cn(lead && "pl-[44px]", trail && "pr-[52px]", className)} {...props} />
      {trail ? (
        <span aria-hidden="true" className={cn(adornment, "right-300")}>
          {trail}
        </span>
      ) : null}
    </div>
  );
}

interface BarcodeRowsProps {
  rows: BarcodeRowValues[];
  unit: ProductUnit;
  salePrice: string;
  errors: ProductFormErrors["rows"];
  onChange: (key: string, patch: Partial<Omit<BarcodeRowValues, "key">>) => void;
  onRemove: (key: string) => void;
  onAdd: () => void;
}

const columns = "grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_44px] gap-x-200";

export function BarcodeRows({
  rows,
  unit,
  salePrice,
  errors,
  onChange,
  onRemove,
  onAdd,
}: BarcodeRowsProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  const remove = (key: string, index: number) => {
    onRemove(key);
    requestAnimationFrame(() => {
      const inputs = sectionRef.current?.querySelectorAll<HTMLElement>("[data-barcode-input]");
      (inputs?.[index] ?? inputs?.[index - 1] ?? addRef.current)?.focus();
    });
  };

  return (
    <section ref={sectionRef} className="grid gap-300">
      <div className="grid gap-100">
        <h3 className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground">
          Barcodes
        </h3>
        <p className="m-0 text-[length:var(--font-size-350)] text-tertiary">
          Scan or type each barcode. A pack barcode sells the pack quantity at once. Leave pack
          price blank to charge unit price × quantity.
        </p>
      </div>
      {rows.length > 0 ? (
        <div className="grid gap-300">
          <div
            aria-hidden="true"
            className={cn(columns, "text-[length:var(--font-size-300)] text-secondary")}
          >
            <span>Barcode</span>
            <span>Pack quantity</span>
            <span>Pack price</span>
            <span />
          </div>
          {rows.map((row, index) => {
            const rowErrors = errors[row.key] ?? {};
            const number = index + 1;
            const invalid = (column: BarcodeColumn) => rowErrors[column] !== undefined;
            const messages = [rowErrors.barcode, rowErrors.packQty, rowErrors.packPrice].filter(
              (text) => text !== undefined,
            );
            return (
              <div key={row.key} data-row-key={row.key} className="grid gap-100">
                <div className={cn(columns, "items-start")}>
                  <Field invalid={invalid("barcode")}>
                    <Input
                      name="barcode"
                      data-barcode-input=""
                      aria-label={`Barcode ${number}`}
                      aria-invalid={invalid("barcode")}
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={64}
                      className="font-mono"
                      value={row.barcode}
                      onChange={(event) => onChange(row.key, { barcode: event.target.value })}
                    />
                  </Field>
                  <Field invalid={invalid("packQty")}>
                    <AdornedInput
                      name="packQty"
                      aria-label={`Pack quantity ${number}`}
                      aria-invalid={invalid("packQty")}
                      inputMode="decimal"
                      autoComplete="off"
                      maxLength={16}
                      trail={unitLabel(unit)}
                      className="text-right tabular-nums"
                      value={row.packQty}
                      onChange={(event) => onChange(row.key, { packQty: event.target.value })}
                    />
                  </Field>
                  <Field invalid={invalid("packPrice")}>
                    <AdornedInput
                      name="packPrice"
                      aria-label={`Pack price ${number}`}
                      aria-invalid={invalid("packPrice")}
                      inputMode="decimal"
                      autoComplete="off"
                      maxLength={16}
                      lead="Rs"
                      placeholder={packPriceHint(salePrice, row.packQty, unit)}
                      className="text-right tabular-nums"
                      value={row.packPrice}
                      onChange={(event) => onChange(row.key, { packPrice: event.target.value })}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Remove barcode ${number}`}
                    title={`Remove barcode ${number}`}
                    className="size-[var(--height-control-md)] px-0"
                    onClick={() => remove(row.key, index)}
                  >
                    <Trash2Icon aria-hidden="true" size={16} strokeWidth={2} />
                  </Button>
                </div>
                {messages.map((text) => (
                  <Field key={text} invalid>
                    <FieldError>{text}</FieldError>
                  </Field>
                ))}
              </div>
            );
          })}
        </div>
      ) : null}
      {rows.length < MAX_BARCODE_ROWS ? (
        <div>
          <Button ref={addRef} type="button" variant="secondary" onClick={onAdd}>
            <PlusIcon aria-hidden="true" size={16} strokeWidth={2} />
            Add barcode
          </Button>
        </div>
      ) : null}
    </section>
  );
}
