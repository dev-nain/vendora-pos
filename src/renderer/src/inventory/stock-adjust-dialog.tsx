import { useRef, useState, type FormEvent } from "react";

import type { StockAdjustmentResult, StockListItem } from "@shared/inventory";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { ErrorLine } from "../users/form-parts";
import { unitLabel } from "../products/product-list";
import { movementReasonLabels, onHandText, signedQuantityText } from "./stock-format";
import {
  changeFor,
  offeredReasons,
  stockAdjustModeItems,
  toAdjustmentInput,
  type StockAdjustForm,
  type StockAdjustMode,
} from "./stock-adjust";

type Refusal = Exclude<StockAdjustmentResult, { ok: true }>;

interface StockAdjustDialogProps {
  item: StockListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: () => HTMLElement | null;
  onAdjusted: (outcome: { changed: boolean; onHandMilli: number }) => void;
  onSessionEnded: () => void;
}

function StockAdjustBody({
  item,
  onClose,
  onAdjusted,
  onSessionEnded,
}: Omit<StockAdjustDialogProps, "open" | "onOpenChange" | "returnFocus"> & {
  onClose: () => void;
}) {
  const [form, setForm] = useState<StockAdjustForm>({ mode: "change", quantity: "", reason: null });
  const [attempted, setAttempted] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const quantityRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLButtonElement>(null);

  const unit = unitLabel(item.unit);
  const counting = form.mode === "count";
  const built = changeFor(form, item.onHandMilli, item.unit);
  const reasons = offeredReasons(built.ok ? built.changeMilli : null);
  const reasonItems = reasons.map((reason) => ({
    value: reason,
    label: movementReasonLabels[reason],
  }));
  const quantityError = attempted && !built.ok ? built.error : null;
  const reasonError = attempted && form.reason === null ? "Pick a reason" : null;

  const edit = (patch: Partial<StockAdjustForm>) => {
    const next = { ...form, ...patch };
    const nextBuilt = changeFor(next, item.onHandMilli, item.unit);
    const allowed = offeredReasons(nextBuilt.ok ? nextBuilt.changeMilli : null);
    setForm({ ...next, reason: next.reason && allowed.includes(next.reason) ? next.reason : null });
    setRefusal(null);
    setServiceError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setAttempted(true);
    const input = built.ok ? toAdjustmentInput(form, item.id, item.unit) : null;
    if (!input) {
      if (!built.ok) quantityRef.current?.focus();
      else reasonRef.current?.focus();
      return;
    }

    setRefusal(null);
    setServiceError(null);
    setPending(true);
    try {
      const result = await window.vendora.inventory.adjustStock(input);
      if (result.ok) {
        onAdjusted(result);
        onClose();
        return;
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

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>Adjust stock</DialogTitle>
        <DialogDescription>
          {item.nameEn}. On hand{" "}
          <span className="tabular-nums">{onHandText(item.onHandMilli, item.unit)}</span>
        </DialogDescription>
        <div className="grid gap-400">
          <Field>
            <FieldLabel>How to adjust</FieldLabel>
            <Select
              items={stockAdjustModeItems}
              value={form.mode}
              onValueChange={(next) => {
                if (typeof next === "string") edit({ mode: next as StockAdjustMode, quantity: "" });
              }}
            >
              <SelectTrigger aria-label="How to adjust" autoFocus>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stockAdjustModeItems.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value}>
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field invalid={quantityError !== null}>
            <FieldLabel htmlFor="stock-adjust-quantity">
              {counting ? `Counted on-hand (${unit})` : `Quantity to add or remove (${unit})`}
            </FieldLabel>
            <Input
              ref={quantityRef}
              id="stock-adjust-quantity"
              inputMode="decimal"
              autoComplete="off"
              className="tabular-nums"
              value={form.quantity}
              onChange={(event) => edit({ quantity: event.target.value })}
            />
            {counting ? null : (
              <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
                Use a minus sign to remove stock.
              </p>
            )}
            {quantityError ? <FieldError>{quantityError}</FieldError> : null}
          </Field>
          <Field invalid={reasonError !== null}>
            <FieldLabel>Reason</FieldLabel>
            <Select
              items={reasonItems}
              value={form.reason}
              onValueChange={(next) => {
                if (typeof next === "string") edit({ reason: next as StockAdjustForm["reason"] });
              }}
            >
              <SelectTrigger ref={reasonRef} aria-label="Reason">
                <SelectValue placeholder="Pick a reason" />
              </SelectTrigger>
              <SelectContent>
                {reasonItems.map((reason) => (
                  <SelectItem key={reason.value} value={reason.value}>
                    {reason.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {reasons.length === 1 ? (
              <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
                Only Correction can raise stock.
              </p>
            ) : null}
            {reasonError ? <FieldError>{reasonError}</FieldError> : null}
          </Field>
        </div>
        {built.ok ? (
          <p
            role="status"
            className="m-0 text-[length:var(--font-size-350)] text-secondary tabular-nums"
          >
            Difference {signedQuantityText(built.changeMilli, item.unit)} · New on hand{" "}
            <span className={built.newOnHandMilli < 0 ? "text-critical" : ""}>
              {onHandText(built.newOnHandMilli, item.unit)}
            </span>
          </p>
        ) : null}
        {refusal ? <ErrorLine>{refusal.message}</ErrorLine> : null}
        {serviceError ? <ErrorLine>{serviceError}</ErrorLine> : null}
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save adjustment"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function StockAdjustDialog({
  open,
  onOpenChange,
  returnFocus,
  ...rest
}: StockAdjustDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent finalFocus={() => returnFocus() ?? true}>
        <StockAdjustBody {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
