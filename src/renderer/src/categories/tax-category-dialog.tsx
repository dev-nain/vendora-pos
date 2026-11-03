import { useRef, useState, type FormEvent } from "react";

import { categoryNameSchema } from "@shared/categories";
import { taxCategoryMessages, type TaxCategory } from "@shared/tax-categories";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { ErrorLine } from "../users/form-parts";
import { formatTaxRate, parseTaxRatePercent, rateInputText } from "./tax-rate-input";

interface TaxCategoryDialogProps {
  taxCategory: TaxCategory | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onSessionEnded: () => void;
}

const focus = (input: { current: HTMLInputElement | null }) =>
  requestAnimationFrame(() => input.current?.focus());

function TaxCategoryForm({
  taxCategory,
  onClose,
  onSaved,
  onSessionEnded,
}: Omit<TaxCategoryDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const [name, setName] = useState(taxCategory?.name ?? "");
  const [rate, setRate] = useState(
    taxCategory?.rateBps != null ? rateInputText(taxCategory.rateBps) : "",
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const nameInput = useRef<HTMLInputElement | null>(null);
  const rateInput = useRef<HTMLInputElement | null>(null);
  const rateLocked = taxCategory?.isSystem === true;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    setServiceError(null);
    const parsedName = categoryNameSchema.safeParse(name);
    if (!parsedName.success) {
      setNameError(parsedName.error.issues[0]?.message ?? "Enter a name");
      setRateError(null);
      focus(nameInput);
      return;
    }
    setNameError(null);

    let rateBps: number | null;
    if (taxCategory && rateLocked) {
      rateBps = taxCategory.rateBps;
    } else {
      const parsedRate = parseTaxRatePercent(rate);
      if (!parsedRate.ok) {
        setRateError(taxCategoryMessages.rateRequired);
        focus(rateInput);
        return;
      }
      rateBps = parsedRate.rateBps;
    }
    setRateError(null);

    setPending(true);
    try {
      const result = taxCategory
        ? await window.vendora.taxCategories.update({
            id: taxCategory.id,
            name: parsedName.data,
            rateBps,
          })
        : await window.vendora.taxCategories.create({
            name: parsedName.data,
            rateBps: rateBps ?? 0,
          });
      if (result.ok) {
        onSaved();
        onClose();
        return;
      }
      if (result.reason === "not-found") onSaved();
      else if (result.reason === "name-taken") focus(nameInput);
      setServiceError(result.message);
    } catch (cause) {
      if (isSessionError(cause)) {
        onSessionEnded();
        return;
      }
      setServiceError(serviceErrorMessage);
    }
    setPending(false);
  };

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>{taxCategory ? `Edit ${taxCategory.name}` : "Add tax category"}</DialogTitle>
        <DialogDescription>
          {taxCategory
            ? "Products keep using this tax category."
            : "Set the tax rate products in this category use."}
        </DialogDescription>
        <Field invalid={nameError !== null}>
          <FieldLabel>Name</FieldLabel>
          <Input
            ref={nameInput}
            autoFocus
            autoComplete="off"
            maxLength={64}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {nameError ? <FieldError>{nameError}</FieldError> : null}
        </Field>
        {rateLocked ? (
          <div className="grid gap-200">
            <span className="text-[length:var(--font-size-350)] text-foreground">Rate</span>
            <p className="m-0 min-h-[var(--height-control-md)] content-center text-[length:var(--font-size-400)] text-foreground">
              {formatTaxRate(taxCategory.rateBps)}
            </p>
            <p className="m-0 text-[length:var(--font-size-350)] text-tertiary">
              Default tax categories keep their rate.
            </p>
          </div>
        ) : (
          <Field invalid={rateError !== null}>
            <FieldLabel>Rate (%)</FieldLabel>
            <Input
              ref={rateInput}
              inputMode="decimal"
              autoComplete="off"
              maxLength={6}
              className="text-right tabular-nums"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
            />
            {rateError ? <FieldError>{rateError}</FieldError> : null}
          </Field>
        )}
        {serviceError ? <ErrorLine>{serviceError}</ErrorLine> : null}
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : taxCategory ? "Save" : "Add tax category"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function TaxCategoryDialog({ open, onOpenChange, ...rest }: TaxCategoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <TaxCategoryForm {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
