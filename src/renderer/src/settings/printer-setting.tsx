import { TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

import { printerMessages, type PrintResult } from "@shared/receipt";
import type { PaperWidthMm, WindowsPrinter } from "@shared/settings";
import { Button } from "@renderer/components/ui/button";
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { cn } from "@renderer/lib/utils";
import { serviceErrorMessage } from "../auth/messages";
import {
  DEFAULT_PORT,
  parsePrinterForm,
  printerFormFrom,
  type PrinterForm,
  type PrinterFormErrors,
} from "./printer-form";

type LoadState = { name: "loading" } | { name: "error" } | { name: "ready" };

type TestState = { kind: "ok"; text: string } | { kind: "failed"; text: string } | null;

const connections: { value: PrinterForm["kind"]; label: string }[] = [
  { value: "none", label: "None" },
  { value: "windows", label: "Windows printer" },
  { value: "network", label: "Network printer" },
];

const widths: { value: PaperWidthMm; label: string }[] = [
  { value: 58, label: "58 mm" },
  { value: 80, label: "80 mm" },
];

const modes: { value: PrinterForm["printMode"]; label: string }[] = [
  { value: "print", label: "Print the receipt" },
  { value: "ask", label: "Ask first" },
  { value: "off", label: "Don't print" },
];

interface ChoicesProps<Value extends string | number> {
  legend: string;
  name: string;
  options: { value: Value; label: string }[];
  value: Value;
  onChange: (value: Value) => void;
}

function Choices<Value extends string | number>({
  legend,
  name,
  options,
  value,
  onChange,
}: ChoicesProps<Value>) {
  return (
    <fieldset className="m-0 grid gap-200 border-0 p-0">
      <legend className="mb-200 p-0 text-[length:var(--font-size-350)] text-foreground">
        {legend}
      </legend>
      <div role="radiogroup" aria-label={legend} className="flex flex-wrap gap-200">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "inline-flex min-h-[var(--height-control-md)] cursor-default items-center gap-200 rounded-100 border border-strong px-400 text-[length:var(--font-size-350)] text-foreground has-[:focus-visible]:shadow-focus",
              value === option.value ? "bg-surface-selected" : "bg-fill-secondary",
            )}
          >
            <input
              type="radio"
              id={`${name}-${option.value}`}
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="size-4 accent-[var(--color-bg-fill-brand)]"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function WarningLine({ children, role }: { children: ReactNode; role?: "alert" }) {
  return (
    <p
      role={role}
      className="m-0 flex items-start gap-200 text-[length:var(--font-size-350)] text-warning"
    >
      <TriangleAlertIcon aria-hidden="true" size={16} strokeWidth={2} className="mt-050 shrink-0" />
      {children}
    </p>
  );
}

export function PrinterSetting({ focusOnReady }: { focusOnReady?: boolean }) {
  const [state, setState] = useState<LoadState>({ name: "loading" });
  const [form, setForm] = useState<PrinterForm | null>(null);
  const [errors, setErrors] = useState<PrinterFormErrors>({});
  const [printers, setPrinters] = useState<WindowsPrinter[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [test, setTest] = useState<TestState>(null);

  const loadPrinters = useCallback(() => {
    window.vendora.printer
      .listWindows()
      .then(setPrinters)
      .catch(() => setPrinters([]));
  }, []);

  const load = useCallback(() => {
    window.vendora.printer
      .getSettings()
      .then((settings) => {
        setForm(printerFormFrom(settings));
        setState({ name: "ready" });
        if (settings.connection.kind === "windows") loadPrinters();
      })
      .catch(() => setState({ name: "error" }));
  }, [loadPrinters]);

  useEffect(load, [load]);

  const retry = () => {
    setState({ name: "loading" });
    load();
  };

  const ready = state.name === "ready";
  useEffect(() => {
    if (!focusOnReady || !ready) return;
    document.getElementById("printer-heading")?.scrollIntoView({ block: "start" });
    document.querySelector<HTMLElement>("#printer-card input[type=radio]:checked")?.focus();
  }, [focusOnReady, ready]);

  const change = (patch: Partial<PrinterForm>) => {
    setForm((current) => current && { ...current, ...patch });
    setSaved(false);
    setTest(null);
  };

  const pickKind = (kind: PrinterForm["kind"]) => {
    change({ kind });
    if (kind === "windows" && printers === null) loadPrinters();
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || !form) return;
    const parsed = parsePrinterForm(form);
    setSaved(false);
    setError(null);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      setForm(printerFormFrom(await window.vendora.printer.setSettings(parsed.settings)));
      setSaved(true);
    } catch {
      setError(serviceErrorMessage);
    } finally {
      setPending(false);
    }
  };

  const runTest = async (action: () => Promise<PrintResult>, okText: string): Promise<void> => {
    if (pending) return;
    setPending(true);
    setTest(null);
    try {
      const result = await action();
      setTest(
        result.successful ? { kind: "ok", text: okText } : { kind: "failed", text: result.message },
      );
    } catch {
      setTest({ kind: "failed", text: printerMessages.error });
    } finally {
      setPending(false);
    }
  };

  const savedNameMissing =
    form?.kind === "windows" &&
    form.windowsName !== "" &&
    printers !== null &&
    !printers.some((printer) => printer.name === form.windowsName);

  return (
    <section
      id="printer-card"
      aria-labelledby="printer-heading"
      className="grid w-[560px] max-w-full gap-400 rounded-300 border border-line-card bg-surface-secondary p-600"
    >
      <h2
        id="printer-heading"
        className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground"
      >
        Receipt printer
      </h2>
      <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
        Receipts print on a 58 mm or 80 mm thermal printer. The cash drawer opens through the
        printer.
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
          <Choices
            legend="Connection"
            name="printer-connection"
            options={connections}
            value={form.kind}
            onChange={pickKind}
          />
          {form.kind === "windows" ? (
            <Field invalid={errors.windowsName !== undefined}>
              <FieldLabel>Printer</FieldLabel>
              <div className="flex items-center gap-200">
                <div className="min-w-0 flex-1">
                  <Select
                    items={(printers ?? []).map((printer) => ({
                      value: printer.name,
                      label: printer.displayName || printer.name,
                    }))}
                    value={form.windowsName === "" ? null : form.windowsName}
                    onValueChange={(next) => {
                      if (typeof next === "string") change({ windowsName: next });
                    }}
                  >
                    <SelectTrigger
                      aria-label="Printer"
                      aria-invalid={errors.windowsName !== undefined}
                    >
                      <SelectValue placeholder="Pick a printer" />
                    </SelectTrigger>
                    <SelectContent>
                      {(printers ?? []).map((printer) => (
                        <SelectItem key={printer.name} value={printer.name}>
                          {printer.displayName || printer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" variant="secondary" onClick={loadPrinters}>
                  Refresh
                </Button>
              </div>
              {printers !== null && printers.length === 0 ? (
                <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
                  No Windows printers found.
                </p>
              ) : null}
              {savedNameMissing ? <WarningLine>{printerMessages.notFound}</WarningLine> : null}
              {errors.windowsName ? <FieldError>{errors.windowsName}</FieldError> : null}
            </Field>
          ) : null}
          {form.kind === "network" ? (
            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-300">
              <Field invalid={errors.host !== undefined}>
                <FieldLabel>Host</FieldLabel>
                <Input
                  name="host"
                  autoComplete="off"
                  maxLength={253}
                  placeholder="192.168.1.50"
                  value={form.host}
                  onChange={(event) => change({ host: event.target.value })}
                />
                {errors.host ? <FieldError>{errors.host}</FieldError> : null}
              </Field>
              <Field invalid={errors.port !== undefined}>
                <FieldLabel>Port</FieldLabel>
                <Input
                  name="port"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={5}
                  placeholder={DEFAULT_PORT}
                  className="tabular-nums"
                  value={form.port}
                  onChange={(event) => change({ port: event.target.value })}
                />
                {errors.port ? <FieldError>{errors.port}</FieldError> : null}
              </Field>
            </div>
          ) : null}
          <Choices
            legend="Paper width"
            name="printer-width"
            options={widths}
            value={form.paperWidthMm}
            onChange={(paperWidthMm) => change({ paperWidthMm })}
          />
          <Choices
            legend="When a sale completes"
            name="printer-mode"
            options={modes}
            value={form.printMode}
            onChange={(printMode) => change({ printMode })}
          />
          {error ? <FieldError role="alert">{error}</FieldError> : null}
          <div className="flex flex-wrap items-center gap-200">
            <Button type="submit" disabled={pending}>
              {pending ? "Working…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                void runTest(() => window.vendora.printer.testPrint(), "Test page sent.")
              }
            >
              Test print
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                void runTest(() => window.vendora.printer.testDrawer(), "Drawer opened.")
              }
            >
              Test drawer
            </Button>
          </div>
          <p className="m-0 text-[length:var(--font-size-300)] text-tertiary">
            Tests use the saved settings.
          </p>
          <p role="status" className="m-0 text-[length:var(--font-size-350)] text-secondary">
            {saved ? "Saved." : test?.kind === "ok" ? test.text : ""}
          </p>
          {test?.kind === "failed" ? <WarningLine role="alert">{test.text}</WarningLine> : null}
        </form>
      ) : null}
    </section>
  );
}
