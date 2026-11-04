import { useRef, useState, type FormEvent, type RefObject } from "react";

import type { AddCashMoveInput } from "@shared/shifts";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import { Kbd } from "@renderer/components/ui/kbd";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { AdornedInput } from "../products/barcode-rows";
import { ErrorLine } from "../users/form-parts";
import { parseCashMoveForm, REASON_MAX, type CashMoveErrors } from "./cash-move-form";

interface CashMoveDialogProps {
  kind: AddCashMoveInput["kind"];
  returnFocus: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onSessionEnded: () => void;
}

function CashMoveForm({
  kind,
  onClose,
  onSaved,
  onSessionEnded,
}: Omit<CashMoveDialogProps, "returnFocus" | "onOpenChange"> & { onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<CashMoveErrors>({});
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const amountInput = useRef<HTMLInputElement | null>(null);
  const reasonInput = useRef<HTMLInputElement | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    const parsed = parseCashMoveForm(kind, amount, reason);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      setServiceError(null);
      requestAnimationFrame(() =>
        (parsed.errors.amount ? amountInput : reasonInput).current?.focus(),
      );
      return;
    }

    setErrors({});
    setServiceError(null);
    setPending(true);
    try {
      const result = await window.vendora.shifts.addCashMove(parsed.input);
      if (result.ok) {
        onSaved();
        onClose();
        return;
      }
      onSaved();
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
        <DialogTitle>{kind === "in" ? "Cash in" : "Cash out"}</DialogTitle>
        <div className="grid gap-400">
          <Field invalid={errors.amount !== undefined}>
            <FieldLabel>Amount</FieldLabel>
            <AdornedInput
              ref={amountInput}
              name="amount"
              autoFocus
              inputMode="decimal"
              autoComplete="off"
              maxLength={16}
              lead="Rs"
              className="text-right tabular-nums"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            {errors.amount ? <FieldError>{errors.amount}</FieldError> : null}
          </Field>
          <Field invalid={errors.reason !== undefined}>
            <FieldLabel>Reason</FieldLabel>
            <Input
              ref={reasonInput}
              name="reason"
              autoComplete="off"
              maxLength={REASON_MAX}
              placeholder="Petty expense, change from bank…"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            {errors.reason ? <FieldError>{errors.reason}</FieldError> : null}
          </Field>
        </div>
        {serviceError ? <ErrorLine>{serviceError}</ErrorLine> : null}
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
          <Kbd>Esc</Kbd>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
          <Kbd>Enter</Kbd>
        </Button>
      </DialogFooter>
    </form>
  );
}

export function CashMoveDialog({ returnFocus, onOpenChange, ...rest }: CashMoveDialogProps) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent finalFocus={returnFocus}>
        <CashMoveForm {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
