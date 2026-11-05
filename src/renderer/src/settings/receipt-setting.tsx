import { Field as FieldPrimitive } from "@base-ui/react/field";
import { useCallback, useEffect, useState, type ComponentProps, type FormEvent } from "react";

import type { ReceiptSettings } from "@shared/settings";
import { Button } from "@renderer/components/ui/button";
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { Input, controlClasses } from "@renderer/components/ui/input";
import { cn } from "@renderer/lib/utils";
import { serviceErrorMessage } from "../auth/messages";
import {
  parseReceiptForm,
  receiptFormFrom,
  type ReceiptForm,
  type ReceiptFormErrors,
} from "./receipt-form";

type LoadState = { name: "loading" } | { name: "error" } | { name: "ready" };

interface TextFieldProps {
  field: keyof ReceiptSettings;
  label: string;
  form: ReceiptForm;
  errors: ReceiptFormErrors;
  onChange: (field: keyof ReceiptSettings, value: string) => void;
  maxLength: number;
  multiline?: boolean;
  urdu?: boolean;
  inputProps?: ComponentProps<typeof Input>;
}

function TextField({
  field,
  label,
  form,
  errors,
  onChange,
  maxLength,
  multiline,
  urdu,
  inputProps,
}: TextFieldProps) {
  const urduProps = urdu
    ? { dir: "rtl", lang: "ur", className: "font-urdu text-[length:var(--font-size-450)]" }
    : {};
  return (
    <Field invalid={errors[field] !== undefined}>
      <FieldLabel>{label}</FieldLabel>
      {multiline ? (
        <FieldPrimitive.Control
          name={field}
          value={form[field]}
          onValueChange={(value) => onChange(field, value)}
          render={
            <textarea
              rows={3}
              maxLength={maxLength}
              autoComplete="off"
              {...urduProps}
              className={cn(controlClasses, "resize-none py-200", urduProps.className)}
            />
          }
        />
      ) : (
        <Input
          name={field}
          autoComplete="off"
          maxLength={maxLength}
          value={form[field]}
          onChange={(event) => onChange(field, event.target.value)}
          {...inputProps}
        />
      )}
      {errors[field] ? <FieldError>{errors[field]}</FieldError> : null}
    </Field>
  );
}

export function ReceiptSetting() {
  const [state, setState] = useState<LoadState>({ name: "loading" });
  const [form, setForm] = useState<ReceiptForm | null>(null);
  const [errors, setErrors] = useState<ReceiptFormErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const load = useCallback(() => {
    window.vendora.settings
      .getReceipt()
      .then((settings) => {
        setForm(receiptFormFrom(settings));
        setState({ name: "ready" });
      })
      .catch(() => setState({ name: "error" }));
  }, []);

  useEffect(load, [load]);

  const retry = () => {
    setState({ name: "loading" });
    load();
  };

  const onChange = (field: keyof ReceiptSettings, value: string) => {
    setForm((current) => current && { ...current, [field]: value });
    setSaved(false);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || !form) return;
    const parsed = parseReceiptForm(form);
    setSaved(false);
    setError(null);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      setForm(receiptFormFrom(await window.vendora.settings.setReceipt(parsed.settings)));
      setSaved(true);
    } catch {
      setError(serviceErrorMessage);
    } finally {
      setPending(false);
    }
  };

  const shared = { form: form as ReceiptForm, errors, onChange };

  return (
    <section
      id="receipt-card"
      aria-labelledby="receipt-heading"
      className="grid w-[560px] max-w-full gap-400 rounded-300 border border-line-card bg-surface-secondary p-600"
    >
      <h2
        id="receipt-heading"
        className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground"
      >
        Receipt
      </h2>
      <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
        The header and footer print on every receipt, including reprints of older sales.
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
      {state.name === "ready" && form ? (
        <form onSubmit={save} noValidate className="grid gap-400">
          <TextField {...shared} field="name" label="Store name" maxLength={100} />
          <TextField {...shared} field="address" label="Address" maxLength={200} />
          <TextField
            {...shared}
            field="phone"
            label="Phone"
            maxLength={30}
            inputProps={{ inputMode: "tel" }}
          />
          <div className="grid grid-cols-2 gap-300">
            <TextField
              {...shared}
              field="ntn"
              label="NTN"
              maxLength={9}
              inputProps={{ placeholder: "1234567-8", className: "tabular-nums" }}
            />
            <TextField
              {...shared}
              field="strn"
              label="STRN"
              maxLength={17}
              inputProps={{ placeholder: "13 digits", className: "tabular-nums" }}
            />
          </div>
          <TextField
            {...shared}
            field="headerEn"
            label="Header (English)"
            maxLength={300}
            multiline
          />
          <TextField
            {...shared}
            field="headerUr"
            label="Header (Urdu)"
            maxLength={300}
            multiline
            urdu
          />
          <TextField
            {...shared}
            field="footerEn"
            label="Footer (English)"
            maxLength={300}
            multiline
          />
          <TextField
            {...shared}
            field="footerUr"
            label="Footer (Urdu)"
            maxLength={300}
            multiline
            urdu
          />
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
