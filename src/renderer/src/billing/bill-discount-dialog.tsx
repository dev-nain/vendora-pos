import { useState, type FormEvent, type KeyboardEvent, type RefObject } from "react";

import type { Bill } from "@shared/checkout";
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
import { cn } from "@renderer/lib/utils";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { AdornedInput } from "../products/barcode-rows";
import { ErrorLine } from "../users/form-parts";
import {
  discountInputText,
  parseDiscountInput,
  toggleDiscountKind,
  type DiscountKind,
} from "./discount-input";

interface BillDiscountDialogProps {
  bill: Bill;
  returnFocus: RefObject<HTMLElement | null>;
  onApplied: (bill: Bill) => void;
  onCancel: () => void;
  onSessionEnded: () => void;
}

const kinds: { kind: DiscountKind; label: string }[] = [
  { kind: "percent", label: "%" },
  { kind: "amount", label: "Rs" },
];

export function BillDiscountDialog({
  bill,
  returnFocus,
  onApplied,
  onCancel,
  onSessionEnded,
}: BillDiscountDialogProps) {
  const [kind, setKind] = useState<DiscountKind>(bill.billDiscount?.kind ?? "percent");
  const [text, setText] = useState(discountInputText(bill.billDiscount));
  const [error, setError] = useState<string | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const save = async (value: string) => {
    if (pending) return;
    const parsed = parseDiscountInput(value, kind);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setPending(true);
    setServiceError(null);
    try {
      const result = await window.vendora.checkout.setBillDiscount({
        draftId: bill.id,
        discount: parsed.discount,
      });
      if (result.ok) {
        onApplied(result.bill);
        return;
      }
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Tab" || event.shiftKey) return;
    event.preventDefault();
    setKind(toggleDiscountKind(kind));
    setError(null);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent finalFocus={returnFocus}>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Bill discount</DialogTitle>
            <Field invalid={error !== null}>
              <FieldLabel>{kind === "percent" ? "Percentage" : "Amount"}</FieldLabel>
              <AdornedInput
                name="discount"
                autoFocus
                inputMode="decimal"
                autoComplete="off"
                maxLength={16}
                {...(kind === "percent" ? { trail: "%" } : { lead: "Rs" })}
                className="text-right tabular-nums"
                value={text}
                onFocus={(event) => event.currentTarget.select()}
                onKeyDown={onKeyDown}
                onChange={(event) => {
                  setText(event.target.value);
                  setError(null);
                }}
              />
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
            <div role="group" aria-label="Discount type" className="grid grid-cols-2 gap-200">
              {kinds.map((option) => (
                <Button
                  key={option.kind}
                  type="button"
                  variant="secondary"
                  aria-pressed={kind === option.kind}
                  className={cn(kind === option.kind && "bg-surface-selected")}
                  onClick={() => {
                    setKind(option.kind);
                    setError(null);
                  }}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <p className="m-0 flex items-center gap-100 text-[length:var(--font-size-300)] text-secondary">
              <Kbd>Tab</Kbd>
              switches between % and Rs
            </p>
            {serviceError ? <ErrorLine>{serviceError}</ErrorLine> : null}
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={pending || bill.billDiscount === null}
              onClick={() => void save("")}
            >
              Clear
            </Button>
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
              <Kbd>Esc</Kbd>
            </Button>
            <Button type="submit" disabled={pending}>
              Apply
              <Kbd>Enter</Kbd>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
