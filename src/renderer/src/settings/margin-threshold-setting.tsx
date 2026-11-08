import { useCallback, useEffect, useState, type FormEvent } from "react";

import { marginThresholdInputSchema } from "@shared/settings";
import { Button } from "@renderer/components/ui/button";
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { serviceErrorMessage } from "../auth/messages";
import { parseTaxRatePercent, rateInputText } from "../categories/tax-rate-input";
import { AdornedInput } from "../products/barcode-rows";

type LoadState = { name: "loading" } | { name: "error" } | { name: "ready" };

const invalidPercent = "Enter a percentage from 0 to 100, like 15 or 12.5, or leave it blank.";
const offStatus = "Off. No prompt after receiving.";

const textFor = (thresholdBps: number | null) =>
  thresholdBps === null ? "" : rateInputText(thresholdBps);

export function MarginThresholdSetting() {
  const [state, setState] = useState<LoadState>({ name: "loading" });
  const [text, setText] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  const load = useCallback(() => {
    window.vendora.settings
      .getMarginThreshold()
      .then(({ thresholdBps }) => {
        setText(textFor(thresholdBps));
        setStatus(thresholdBps === null ? offStatus : "");
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

    const percent = text.trim() === "" ? null : parseTaxRatePercent(text);
    const parsed = marginThresholdInputSchema.safeParse({
      thresholdBps: percent?.ok ? percent.rateBps : null,
    });
    setStatus("");
    setError(null);
    if ((percent && !percent.ok) || !parsed.success) {
      setFieldError(invalidPercent);
      return;
    }

    setFieldError(null);
    setPending(true);
    try {
      const result = await window.vendora.settings.setMarginThreshold(parsed.data.thresholdBps);
      setText(textFor(result.thresholdBps));
      setStatus(result.thresholdBps === null ? offStatus : "Saved.");
    } catch {
      setError(serviceErrorMessage);
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      aria-labelledby="margin-check-heading"
      className="grid w-[420px] max-w-full gap-400 rounded-300 border border-line-card bg-surface-secondary p-600"
    >
      <h2
        id="margin-check-heading"
        className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground"
      >
        Margin check
      </h2>
      <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
        After goods are received, list products whose margin is below this, so you can update their
        sale price. Margin is (sale price without sales tax − average cost) ÷ sale price without
        sales tax. Leave blank to turn this off.
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
            <FieldLabel>Prompt below</FieldLabel>
            <AdornedInput
              name="marginThreshold"
              inputMode="decimal"
              autoComplete="off"
              maxLength={6}
              trail="%"
              className="text-right tabular-nums"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setStatus("");
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
              {status}
            </p>
          </div>
        </form>
      ) : null}
    </section>
  );
}
