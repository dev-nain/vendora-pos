import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import type { BulkUpdateProductsResult, ProductSearchItem } from "@shared/products";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { formatRupees } from "../lib/money";
import { ErrorLine } from "../users/form-parts";
import {
  PREVIEW_ROW_LIMIT,
  buildChange,
  previewRows,
  type BulkEditForm,
  type BulkEditMode,
} from "./bulk-edit";

type Refusal = Exclude<BulkUpdateProductsResult, { ok: true }>;

interface BulkEditDialogProps {
  items: readonly ProductSearchItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: (outcome: { changed: number; unchanged: number }) => void;
  onIneligible: (productIds: string[]) => void;
  onSessionEnded: () => void;
}

const modeItems: { value: BulkEditMode; label: string }[] = [
  { value: "percent", label: "Change price by %" },
  { value: "price", label: "Set sale price" },
  { value: "category", label: "Category" },
];

const plural = (count: number): string => (count === 1 ? "product" : "products");

function RefusalLines({ refusal }: { refusal: Refusal }) {
  if (refusal.reason !== "above-mrp") return <ErrorLine>{refusal.message}</ErrorLine>;
  const shown = refusal.products.slice(0, PREVIEW_ROW_LIMIT);
  const more = refusal.products.length - shown.length;
  return (
    <div className="grid gap-100">
      <ErrorLine>{refusal.message}</ErrorLine>
      {shown.map((product) => (
        <ErrorLine key={product.id}>
          {`${product.nameEn} — ${formatRupees(product.salePricePaisa)} is above MRP ${formatRupees(product.mrpPaisa)}`}
        </ErrorLine>
      ))}
      {more > 0 ? <ErrorLine>{`and ${more} more`}</ErrorLine> : null}
    </div>
  );
}

function BulkEditBody({
  items,
  onClose,
  onApplied,
  onIneligible,
  onSessionEnded,
}: Omit<BulkEditDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const [form, setForm] = useState<BulkEditForm>({
    mode: "percent",
    percent: "",
    price: "",
    categoryId: null,
  });
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const loadCategories = useCallback(() => {
    window.vendora.categories
      .list()
      .then((list) => setCategories(list))
      .catch((cause: unknown) => {
        if (isSessionError(cause)) onSessionEnded();
        else setServiceError(serviceErrorMessage);
      });
  }, [onSessionEnded]);

  useEffect(loadCategories, [loadCategories]);

  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );
  const built = buildChange(form);
  const change = "kind" in built ? built : null;
  const fieldError = "error" in built ? built.error : null;
  const preview = change ? previewRows(items, change, categoryNames) : null;
  const canApply = change !== null && preview !== null && preview.changing > 0 && !pending;

  const edit = (patch: Partial<BulkEditForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setRefusal(null);
    setServiceError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || !change || !canApply) return;

    setRefusal(null);
    setServiceError(null);
    setPending(true);
    try {
      const result = await window.vendora.products.bulkUpdate({
        productIds: items.map((item) => item.id),
        change,
      });
      if (result.ok) {
        onApplied(result);
        onClose();
        return;
      }
      if (result.reason === "ineligible-products") onIneligible(result.productIds);
      if (result.reason === "category-not-found") {
        setForm((current) => ({ ...current, categoryId: null }));
        loadCategories();
      }
      setRefusal(result);
    } catch (cause) {
      if (isSessionError(cause)) {
        onSessionEnded();
        return;
      }
      setServiceError(serviceErrorMessage);
    }
    setPending(false);
  };

  const categoryItems = categories.map((category) => ({
    value: category.id,
    label: category.name,
  }));

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>
          Edit {items.length} {plural(items.length)}
        </DialogTitle>
        <DialogDescription>
          Changes apply to every selected product. Pack barcode prices aren't changed.
        </DialogDescription>
        <div className="grid gap-400">
          <Field>
            <FieldLabel>What to change</FieldLabel>
            <Select
              items={modeItems}
              value={form.mode}
              onValueChange={(next) => {
                if (typeof next === "string") edit({ mode: next as BulkEditMode });
              }}
            >
              <SelectTrigger aria-label="What to change" autoFocus>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modeItems.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value}>
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {form.mode === "percent" ? (
            <Field invalid={fieldError !== null}>
              <FieldLabel>Change by (%)</FieldLabel>
              <Input
                id="bulk-edit-percent"
                inputMode="decimal"
                autoComplete="off"
                value={form.percent}
                onChange={(event) => edit({ percent: event.target.value })}
              />
              {fieldError ? (
                <FieldError>{fieldError}</FieldError>
              ) : (
                <FieldDescription>
                  Use a minus sign to lower prices. Prices round to the nearest rupee.
                </FieldDescription>
              )}
            </Field>
          ) : null}
          {form.mode === "price" ? (
            <Field invalid={fieldError !== null}>
              <FieldLabel>New sale price (Rs)</FieldLabel>
              <Input
                id="bulk-edit-price"
                inputMode="decimal"
                autoComplete="off"
                value={form.price}
                onChange={(event) => edit({ price: event.target.value })}
              />
              {fieldError ? <FieldError>{fieldError}</FieldError> : null}
            </Field>
          ) : null}
          {form.mode === "category" ? (
            <Field>
              <FieldLabel>New category</FieldLabel>
              <Select
                items={categoryItems}
                value={form.categoryId}
                onValueChange={(next) => {
                  if (typeof next === "string") edit({ categoryId: next });
                }}
              >
                <SelectTrigger aria-label="New category">
                  <SelectValue placeholder="Pick a category" />
                </SelectTrigger>
                <SelectContent>
                  {categoryItems.map((category) => (
                    <SelectItem key={category.value} value={category.value}>
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
        </div>
        {preview ? (
          <div className="grid gap-200">
            <p
              role="status"
              className="m-0 text-[length:var(--font-size-350)] text-secondary tabular-nums"
            >
              {preview.changing === 0
                ? "No selected product changes."
                : `${preview.changing} of ${preview.total} selected ${plural(preview.total)} will change`}
            </p>
            {preview.rows.length > 0 ? (
              <table className="w-full table-fixed border-collapse text-[length:var(--font-size-350)]">
                <thead className="sr-only">
                  <tr>
                    <th>Name</th>
                    <th>Before</th>
                    <th>After</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.id}>
                      <td
                        className="h-[var(--height-control-sm)] truncate pr-200"
                        title={row.nameEn}
                      >
                        {row.nameEn}
                      </td>
                      <td className="w-[112px] truncate text-right text-secondary tabular-nums">
                        {row.before}
                      </td>
                      <td className="w-[112px] truncate text-right font-semibold tabular-nums">
                        {row.after}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {preview.changing > preview.rows.length ? (
              <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
                and {preview.changing - preview.rows.length} more
              </p>
            ) : null}
          </div>
        ) : null}
        {refusal ? <RefusalLines refusal={refusal} /> : null}
        {serviceError ? <ErrorLine>{serviceError}</ErrorLine> : null}
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canApply}>
          {pending
            ? "Applying…"
            : preview && preview.changing > 0
              ? `Apply to ${preview.changing} ${plural(preview.changing)}`
              : "Apply"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function BulkEditDialog({ open, onOpenChange, ...rest }: BulkEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <BulkEditBody {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
