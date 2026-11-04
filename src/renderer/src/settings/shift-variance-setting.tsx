import { useCallback, useEffect, useState, type FormEvent } from "react";

import { shiftVarianceInputSchema } from "@shared/settings";
import { Button } from "@renderer/components/ui/button";
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { parseRupees, rupeeInputText } from "@renderer/lib/money";
import { serviceErrorMessage } from "../auth/messages";
import { AdornedInput } from "../products/barcode-rows";

type LoadState = { name: "loading" } | { name: "error" } | { name: "ready" };

const invalidAmount = "Enter an amount like 150 or 150.50, up to Rs 1,000,000";

export function ShiftVarianceSetting() {
  const [state, setState] = useState<LoadState>({ name: "loading" });
  const [text, setText] = useState("0");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const load = useCallback(() => {
    window.vendora.settings
      .getShiftVarianceWarn()
      .then(({ warnPaisa }) => {
        setText(rupeeInputText(warnPaisa));
        setState({ name: "ready" });
      })
      .catch(() => setState({ name: "error" }));
  }, []);

  useEffect(load, [load]);

  const retry = () => {
    setState({ name: "loading" });
    load();
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    const amount = parseRupees(text);
    const parsed = amount.ok
      ? shiftVarianceInputSchema.safeParse({ warnPaisa: amount.paisa })
      : null;
    setSaved(false);
    setError(null);
    if (!parsed?.success) {
      setFieldError(invalidAmount);
      return;
    }

    setFieldError(null);
    setPending(true);
    try {
      const result = await window.vendora.settings.setShiftVarianceWarn(parsed.data.warnPaisa);
      setText(rupeeInputText(result.warnPaisa));
      setSaved(true);
    } catch {
      setError(serviceErrorMessage);
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      aria-labelledby="shift-close-heading"
      className="grid w-[420px] max-w-full gap-400 rounded-300 border border-line-card bg-surface-secondary p-600"
    >
      <h2
        id="shift-close-heading"
        className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground"
      >
        Shift close
      </h2>
      <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
        Warn the cashier when counted cash differs from expected by more than this amount. Rs 0
        warns on any difference.
      </p>
      {state.name === "loading" ? (
        <p className="m-0 text-[length:var(--font-size-350)] text-secondary">Loading…</p>
      ) : null}
      {state.name === "error" ? (
        <div className="grid gap-200">
          <p role="alert" className="m-0 text-[length:var(--font-size-350)] text-secondary">
            {serviceErrorMessage}
          </p>
          <Button variant="secondary" onClick={retry}>
            Retry
          </Button>
        </div>
      ) : null}
      {state.name === "ready" ? (
        <form onSubmit={save} noValidate className="grid gap-400">
          <Field invalid={fieldError !== null}>
            <FieldLabel>Warn above</FieldLabel>
            <AdornedInput
              name="warnAbove"
              inputMode="decimal"
              autoComplete="off"
              maxLength={16}
              lead="Rs"
              className="text-right tabular-nums"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setSaved(false);
              }}
            />
            {fieldError ? <FieldError>{fieldError}</FieldError> : null}
          </Field>
          {error ? <FieldError role="alert">{error}</FieldError> : null}
          <div className="flex items-center gap-400">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <p role="status" className="m-0 text-[length:var(--font-size-350)] text-secondary">
              {saved ? "Saved." : ""}
            </p>
          </div>
        </form>
      ) : null}
    </section>
  );
}
