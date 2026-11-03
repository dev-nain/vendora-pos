import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import type { Category } from "@shared/categories";
import type { Product } from "@shared/products";
import type { TaxCategory } from "@shared/tax-categories";
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
import { Kbd } from "@renderer/components/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { cn } from "@renderer/lib/utils";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { formatTaxRate } from "../categories/tax-rate-input";
import { ErrorLine } from "../users/form-parts";
import { AdornedInput, BarcodeRows } from "./barcode-rows";
import { DiscardChangesDialog } from "./discard-changes-dialog";
import {
  buildProductPayload,
  emptyProductForm,
  formFromProduct,
  isFormDirty,
  newBarcodeRow,
  refusalErrors,
  saveProduct,
  unitOptions,
  type BarcodeRowValues,
  type FocusTarget,
  type ProductField,
  type ProductFormErrors,
  type ProductFormValues,
} from "./product-form";
import { unitLabel } from "./product-list";

interface ProductDialogProps {
  productId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (product: Product, mode: "added" | "saved") => void;
  onStale: () => void;
  onSessionEnded: () => void;
}

interface CloseGuard {
  dirty: boolean;
  pending: boolean;
}

type FormProps = Omit<ProductDialogProps, "open" | "onOpenChange"> & {
  onGuardChange: (guard: CloseGuard) => void;
  onClose: () => void;
};

const noErrors = (): ProductFormErrors => ({ fields: {}, rows: {}, form: null });

const controlProps = { autoComplete: "off", spellCheck: false } as const;
const moneyProps = {
  inputMode: "decimal",
  autoComplete: "off",
  maxLength: 16,
  lead: "Rs",
  className: "text-right tabular-nums",
} as const;

function FormField({
  label,
  description,
  error,
  className,
  children,
}: {
  label: string;
  description?: string;
  error: string | undefined;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Field invalid={error !== undefined} className={className}>
      <FieldLabel>{label}</FieldLabel>
      {children}
      {error ? (
        <FieldError>{error}</FieldError>
      ) : description ? (
        <FieldDescription>{description}</FieldDescription>
      ) : null}
    </Field>
  );
}

function focusTarget(form: HTMLFormElement | null, target: FocusTarget): void {
  if (!form || !target) return;
  const selector =
    target.kind === "field"
      ? `[name="${target.field}"], [data-field="${target.field}"]`
      : `[data-row-key="${target.key}"] [name="${target.column}"]`;
  form.querySelector<HTMLElement>(selector)?.focus();
}

function ProductForm({
  productId,
  onGuardChange,
  onClose,
  onSaved,
  onStale,
  onSessionEnded,
}: FormProps) {
  const [editingId, setEditingId] = useState(productId);
  const [lists, setLists] = useState<{ categories: Category[]; taxCategories: TaxCategory[] }>();
  const [initial, setInitial] = useState<ProductFormValues | null>(null);
  const [values, setValues] = useState<ProductFormValues | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<ProductFormErrors>(noErrors);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);

  const sessionEnded = useRef(onSessionEnded);
  useEffect(() => {
    sessionEnded.current = onSessionEnded;
  }, [onSessionEnded]);

  const fail = (cause: unknown): string | null => {
    if (isSessionError(cause)) {
      onSessionEnded();
      return null;
    }
    return serviceErrorMessage;
  };

  useEffect(() => {
    let active = true;
    const { vendora } = window;
    Promise.all([
      vendora.categories.list(),
      vendora.taxCategories.list(),
      productId ? vendora.products.get(productId) : null,
    ])
      .then(([categories, taxCategories, loaded]) => {
        if (!active) return;
        if (loaded && !loaded.ok) {
          setLoadError(loaded.message);
          return;
        }
        const start = loaded
          ? formFromProduct(loaded.product)
          : emptyProductForm(categories, taxCategories);
        setLists({ categories, taxCategories });
        setInitial(start);
        setValues(start);
        requestAnimationFrame(() =>
          focusTarget(formRef.current, { kind: "field", field: "nameEn" }),
        );
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (isSessionError(cause)) sessionEnded.current();
        else setLoadError(serviceErrorMessage);
      });
    return () => {
      active = false;
    };
  }, [productId]);

  const dirty = values !== null && initial !== null && isFormDirty(initial, values);
  useEffect(() => {
    onGuardChange({ dirty, pending });
  }, [onGuardChange, dirty, pending]);

  const focusFirstInvalid = () =>
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
    );

  const setField = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) =>
    setValues((current) => (current ? { ...current, [key]: value } : current));

  const text = (field: ProductField) => ({
    name: field,
    "aria-invalid": errors.fields[field] !== undefined,
    value: values?.[field] ?? "",
    onChange: (event: { target: { value: string } }) => setField(field, event.target.value),
  });

  const changeRow = (key: string, patch: Partial<Omit<BarcodeRowValues, "key">>) =>
    setValues((current) =>
      current
        ? {
            ...current,
            barcodes: current.barcodes.map((row) => (row.key === key ? { ...row, ...patch } : row)),
          }
        : current,
    );

  const addRow = () => {
    const row = newBarcodeRow();
    setValues((current) =>
      current ? { ...current, barcodes: [...current.barcodes, row] } : current,
    );
    requestAnimationFrame(() =>
      focusTarget(formRef.current, { kind: "row", key: row.key, column: "barcode" }),
    );
  };

  const removeRow = (key: string) =>
    setValues((current) =>
      current
        ? { ...current, barcodes: current.barcodes.filter((row) => row.key !== key) }
        : current,
    );

  const submit = async () => {
    if (submitting.current || values === null) return;
    const built = buildProductPayload(values);
    if (!built.ok) {
      setErrors(built.errors);
      focusFirstInvalid();
      return;
    }
    setErrors(noErrors());
    submitting.current = true;
    setPending(true);
    try {
      const result = await saveProduct(
        window.vendora.products,
        editingId,
        built.payload,
        values.isActive,
      );
      const mode = editingId ? "saved" : "added";
      if (!result.ok) {
        const refused = refusalErrors(result, values);
        setErrors(refused.errors);
        requestAnimationFrame(() => focusTarget(formRef.current, refused.focus));
        if (result.reason === "not-found") onStale();
        else if (result.reason === "category-not-found") reloadLists("categories");
        else if (result.reason === "tax-category-not-found") reloadLists("taxCategories");
      } else if (result.statusError === null) {
        onSaved(result.product, mode);
        onGuardChange({ dirty: false, pending: false });
        onClose();
        return;
      } else {
        const saved = formFromProduct(result.product);
        setEditingId(result.product.id);
        setInitial(saved);
        setValues(saved);
        setErrors({ fields: {}, rows: {}, form: result.statusError });
        onSaved(result.product, mode);
      }
    } catch (cause) {
      setErrors({ fields: {}, rows: {}, form: fail(cause) });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  const reloadLists = (which: "categories" | "taxCategories") => {
    const { vendora } = window;
    const load = which === "categories" ? vendora.categories.list() : vendora.taxCategories.list();
    load
      .then((list) => setLists((current) => (current ? { ...current, [which]: list } : current)))
      .catch((cause: unknown) => {
        const message = fail(cause);
        if (message) setErrors((current) => ({ ...current, form: message }));
      });
  };

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void submit();
      return;
    }
    const target = event.target;
    if (
      event.key !== "Enter" ||
      event.nativeEvent.isComposing ||
      !(target instanceof HTMLInputElement)
    )
      return;
    event.preventDefault();
    if (target.type === "checkbox") return;
    const form = event.currentTarget;
    if (target.hasAttribute("data-barcode-input")) {
      if (target.value.trim() === "") return;
      const inputs = [...form.querySelectorAll<HTMLElement>("[data-barcode-input]")];
      const next = inputs[inputs.indexOf(target) + 1];
      if (next) next.focus();
      else addRow();
      return;
    }
    const texts = form.querySelectorAll('input:not([type="checkbox"])');
    if (texts[texts.length - 1] === target) void submit();
  };

  const busy = values === null;
  const unit = values?.unit ?? "piece";
  const categoryItems = (lists?.categories ?? []).map((c) => ({ value: c.id, label: c.name }));
  const taxItems = (lists?.taxCategories ?? []).map((t) => ({
    value: t.id,
    label: `${t.name} · ${formatTaxRate(t.rateBps)}`,
  }));

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={onFormSubmit}
      onKeyDown={onKeyDown}
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]"
    >
      <DialogHeader>
        <DialogTitle>
          {productId ? `Edit ${initial?.nameEn ?? "product"}` : "Add product"}
        </DialogTitle>
        {productId ? null : (
          <DialogDescription>Barcodes and pack sizes can be added now or later.</DialogDescription>
        )}
      </DialogHeader>
      <div className="grid content-start gap-600 overflow-y-auto px-600 pb-600">
        {values === null ? (
          loadError ? (
            <ErrorLine>{loadError}</ErrorLine>
          ) : (
            <p className="m-0 text-secondary">Loading product…</p>
          )
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-400 gap-y-400">
              <FormField label="Name (English)" error={errors.fields.nameEn}>
                <Input {...text("nameEn")} {...controlProps} maxLength={120} />
              </FormField>
              <FormField label="Name (Urdu)" description="Optional" error={errors.fields.nameUr}>
                <Input
                  {...text("nameUr")}
                  {...controlProps}
                  dir="rtl"
                  lang="ur"
                  maxLength={120}
                  className="min-h-[var(--height-control-lg)] text-right font-urdu leading-[var(--line-height-urdu)]"
                />
              </FormField>
              <FormField label="Category" error={errors.fields.categoryId}>
                <Select
                  items={categoryItems}
                  value={values.categoryId}
                  onValueChange={(next) => {
                    if (typeof next === "string") setField("categoryId", next);
                  }}
                >
                  <SelectTrigger
                    data-field="categoryId"
                    aria-invalid={errors.fields.categoryId !== undefined}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Tax category" error={errors.fields.taxCategoryId}>
                <Select
                  items={taxItems}
                  value={values.taxCategoryId}
                  onValueChange={(next) => {
                    if (typeof next === "string") setField("taxCategoryId", next);
                  }}
                >
                  <SelectTrigger
                    data-field="taxCategoryId"
                    aria-invalid={errors.fields.taxCategoryId !== undefined}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {taxItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Brand" error={errors.fields.brand}>
                <Input {...text("brand")} {...controlProps} maxLength={64} />
              </FormField>
              <FormField label="Unit" error={undefined}>
                <Select
                  items={unitOptions}
                  value={values.unit}
                  onValueChange={(next) => {
                    const option = unitOptions.find((entry) => entry.value === next);
                    if (option) setField("unit", option.value);
                  }}
                >
                  <SelectTrigger data-field="unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {unitOptions.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Internal code" error={errors.fields.internalCode}>
                <Input
                  {...text("internalCode")}
                  {...controlProps}
                  maxLength={32}
                  className="font-mono"
                />
              </FormField>
              <FormField label="PCT/HS code" error={errors.fields.pctCode}>
                <Input
                  {...text("pctCode")}
                  {...controlProps}
                  maxLength={16}
                  className="font-mono"
                />
              </FormField>
              <div className="col-span-2 grid gap-200">
                <div className="grid grid-cols-3 gap-x-400">
                  <FormField label="Cost" error={errors.fields.cost}>
                    <AdornedInput {...text("cost")} {...moneyProps} />
                  </FormField>
                  <FormField label="Sale price" error={errors.fields.salePrice}>
                    <AdornedInput {...text("salePrice")} {...moneyProps} />
                  </FormField>
                  <FormField label="MRP" error={errors.fields.mrp}>
                    <AdornedInput {...text("mrp")} {...moneyProps} placeholder="Optional" />
                  </FormField>
                </div>
                <p className="m-0 text-[length:var(--font-size-350)] text-tertiary">
                  Rupees, up to 2 decimals.
                </p>
              </div>
              <FormField label="Low-stock threshold" error={errors.fields.lowStock}>
                <AdornedInput
                  {...text("lowStock")}
                  inputMode="decimal"
                  autoComplete="off"
                  maxLength={16}
                  trail={unitLabel(unit)}
                  placeholder="Optional"
                  className="text-right tabular-nums"
                />
              </FormField>
              <label className="flex min-h-[var(--height-control-md)] cursor-pointer items-center gap-300 self-end">
                <input
                  type="checkbox"
                  name="isActive"
                  checked={values.isActive}
                  onChange={(event) => setField("isActive", event.target.checked)}
                  className={cn(
                    "size-[20px] shrink-0 outline-none focus-visible:shadow-focus",
                    "accent-[var(--color-bg-fill-brand)]",
                  )}
                />
                <span className="grid">
                  <span className="text-[length:var(--font-size-400)] text-foreground">Active</span>
                  <span className="text-[length:var(--font-size-350)] text-tertiary">
                    Archived products are hidden from billing and search.
                  </span>
                </span>
              </label>
            </div>
            <BarcodeRows
              rows={values.barcodes}
              unit={values.unit}
              salePrice={values.salePrice}
              errors={errors.rows}
              onChange={changeRow}
              onRemove={removeRow}
              onAdd={addRow}
            />
            {errors.form ? <ErrorLine>{errors.form}</ErrorLine> : null}
          </>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || pending}>
          {pending ? "Saving…" : productId || editingId ? "Save" : "Add product"}
          <Kbd>Ctrl+S</Kbd>
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ProductDialog({ open, onOpenChange, ...rest }: ProductDialogProps) {
  const guard = useRef<CloseGuard>({ dirty: false, pending: false });
  const [discardOpen, setDiscardOpen] = useState(false);

  const setGuard = useCallback((next: CloseGuard) => {
    guard.current = next;
  }, []);

  const requestClose = () => {
    if (guard.current.pending) return;
    if (guard.current.dirty) setDiscardOpen(true);
    else onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else requestClose();
      }}
    >
      <DialogContent className="grid max-h-[calc(100vh-64px)] w-[min(880px,calc(100vw-32px))] grid-rows-[minmax(0,1fr)]">
        <ProductForm {...rest} onGuardChange={setGuard} onClose={requestClose} />
        <DiscardChangesDialog
          open={discardOpen}
          onKeepEditing={() => setDiscardOpen(false)}
          onDiscard={() => {
            setDiscardOpen(false);
            setGuard({ dirty: false, pending: false });
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
