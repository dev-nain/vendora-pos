import { useState, type FormEvent, type RefObject } from "react";

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
import { Input } from "@renderer/components/ui/input";
import { Kbd } from "@renderer/components/ui/kbd";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { parseRupees } from "../lib/money";
import { AdornedInput } from "../products/barcode-rows";
import { ErrorLine } from "../users/form-parts";

const NAME_MAX = 80;
const DEFAULT_NAME = "Misc item";

interface MiscItemDialogProps {
  returnFocus: RefObject<HTMLElement | null>;
  onAdded: (bill: Bill) => void;
  onCancel: () => void;
  onSessionEnded: () => void;
}

export function MiscItemDialog({
  returnFocus,
  onAdded,
  onCancel,
  onSessionEnded,
}: MiscItemDialogProps) {
  const [price, setPrice] = useState("");
  const [name, setName] = useState(DEFAULT_NAME);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const parsed = parseRupees(price);
    const trimmed = name.trim();
    const badPrice = !parsed.ok || parsed.paisa === 0;
    const badName = trimmed.length === 0 || trimmed.length > NAME_MAX;
    setPriceError(badPrice ? "Enter a price above 0." : null);
    setNameError(badName ? `Enter a name up to ${NAME_MAX} characters.` : null);
    if (badPrice || badName || !parsed.ok) return;

    setPending(true);
    setServiceError(null);
    try {
      const result = await window.vendora.checkout.addMisc({
        name: trimmed,
        pricePaisa: parsed.paisa,
      });
      if (result.ok) {
        onAdded(result.bill);
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

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent finalFocus={returnFocus}>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Misc item</DialogTitle>
            <div className="grid gap-400">
              <Field invalid={priceError !== null}>
                <FieldLabel>Price</FieldLabel>
                <AdornedInput
                  name="price"
                  autoFocus
                  inputMode="decimal"
                  autoComplete="off"
                  maxLength={16}
                  lead="Rs"
                  className="text-right tabular-nums"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                />
                {priceError ? <FieldError>{priceError}</FieldError> : null}
              </Field>
              <Field invalid={nameError !== null}>
                <FieldLabel>Name</FieldLabel>
                <Input
                  name="name"
                  autoComplete="off"
                  maxLength={NAME_MAX}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                {nameError ? <FieldError>{nameError}</FieldError> : null}
              </Field>
            </div>
            {serviceError ? <ErrorLine>{serviceError}</ErrorLine> : null}
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
              <Kbd>Esc</Kbd>
            </Button>
            <Button type="submit" disabled={pending}>
              Add
              <Kbd>Enter</Kbd>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
