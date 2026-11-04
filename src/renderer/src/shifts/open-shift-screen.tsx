import { useState, type FormEvent } from "react";

import { floatSchema } from "@shared/shifts";
import { Button } from "@renderer/components/ui/button";
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { Kbd } from "@renderer/components/ui/kbd";
import { formatRupees, parseRupees, rupeeInputText } from "@renderer/lib/money";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { AdornedInput } from "../products/barcode-rows";
import { ErrorLine } from "../users/form-parts";

const invalidAmount = "Enter an amount like 5000 or 5000.50";

interface OpenShiftScreenProps {
  suggestedFloatPaisa: number;
  onChanged: () => void;
  onSessionEnded: () => void;
}

export function OpenShiftScreen({
  suggestedFloatPaisa,
  onChanged,
  onSessionEnded,
}: OpenShiftScreenProps) {
  const [text, setText] = useState(rupeeInputText(suggestedFloatPaisa));
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    const amount = parseRupees(text);
    const float = amount.ok ? floatSchema.safeParse(amount.paisa) : null;
    if (!float?.success) {
      setFieldError(invalidAmount);
      setServiceError(null);
      return;
    }

    setFieldError(null);
    setServiceError(null);
    setPending(true);
    try {
      const result = await window.vendora.shifts.open(float.data);
      if (result.ok || result.reason === "already-open") {
        onChanged();
        return;
      }
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
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-800">
      <form
        onSubmit={submit}
        noValidate
        aria-labelledby="open-shift-heading"
        className="grid w-[420px] max-w-full gap-400 rounded-300 border border-line-card bg-surface-secondary p-600"
      >
        <div className="grid gap-100">
          <h1
            id="open-shift-heading"
            className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground"
          >
            Open shift
          </h1>
          <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
            Count the cash in the drawer to start.
          </p>
        </div>
        <Field invalid={fieldError !== null}>
          <FieldLabel>Opening float</FieldLabel>
          <AdornedInput
            id="opening-float"
            name="openingFloat"
            autoFocus
            inputMode="decimal"
            autoComplete="off"
            maxLength={16}
            lead="Rs"
            className="text-right tabular-nums"
            value={text}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setText(event.target.value)}
          />
          {fieldError ? <FieldError>{fieldError}</FieldError> : null}
          <p className="m-0 text-[length:var(--font-size-300)] text-tertiary">
            {suggestedFloatPaisa > 0
              ? `Last closing count: ${formatRupees(suggestedFloatPaisa)}`
              : "No earlier shift"}
          </p>
        </Field>
        {serviceError ? <ErrorLine>{serviceError}</ErrorLine> : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Opening…" : "Open shift"}
          <Kbd>Enter</Kbd>
        </Button>
      </form>
    </div>
  );
}
