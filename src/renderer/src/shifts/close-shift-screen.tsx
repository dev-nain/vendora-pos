import { TriangleAlertIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import {
  isVarianceWarning,
  variancePaisa,
  type Denomination,
  type HeldBillSummary,
  type ShiftReport,
} from "@shared/shifts";
import { Button } from "@renderer/components/ui/button";
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import { Kbd } from "@renderer/components/ui/kbd";
import { formatRupees } from "@renderer/lib/money";
import { cn } from "@renderer/lib/utils";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { AdornedInput } from "../products/barcode-rows";
import { ErrorLine } from "../users/form-parts";
import {
  liveCountedPaisa,
  parseCountForm,
  type CountFormErrors,
  type CountMode,
} from "./count-form";
import { varianceLabel } from "./shift-report-view";

interface CloseShiftScreenProps {
  shiftId: string;
  expectedPaisa: number;
  expectedLabel: string;
  heldBills: HeldBillSummary[];
  varianceWarnPaisa: number;
  onCancel: () => void;
  onClosed: (report: ShiftReport) => void;
  onChanged: () => void;
  onSessionEnded: () => void;
}

const figure =
  "font-display text-[length:var(--font-size-550)] font-semibold tabular-nums text-foreground";

const modes: { value: CountMode; label: string }[] = [
  { value: "denominations", label: "By note and coin" },
  { value: "total", label: "Total only" },
];

export function CloseShiftScreen({
  shiftId,
  expectedPaisa,
  expectedLabel,
  heldBills,
  varianceWarnPaisa,
  onCancel,
  onClosed,
  onChanged,
  onSessionEnded,
}: CloseShiftScreenProps) {
  const [denominations, setDenominations] = useState<Denomination[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [mode, setMode] = useState<CountMode>("denominations");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [totalText, setTotalText] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<CountFormErrors>({ counts: {} });
  const [refusal, setRefusal] = useState<string | null>(null);
  const [bills, setBills] = useState<HeldBillSummary[]>(heldBills);
  const [pending, setPending] = useState(false);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const refusalRef = useRef<HTMLDivElement | null>(null);

  const loadDenominations = useCallback(() => {
    window.vendora.shifts
      .listDenominations()
      .then((rows) => {
        setDenominations(rows);
        setLoadFailed(false);
      })
      .catch((cause: unknown) => {
        if (isSessionError(cause)) {
          onSessionEnded();
          return;
        }
        setLoadFailed(true);
      });
  }, [onSessionEnded]);

  useEffect(loadDenominations, [loadDenominations]);

  const loaded = denominations !== null;
  useEffect(() => {
    if (loaded) {
      tableRef.current?.querySelector<HTMLInputElement>("input[data-denomination-value]")?.focus();
    }
  }, [loaded]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const list = denominations ?? [];
  const counted = liveCountedPaisa(list, { mode, counts, totalText });
  const variance = counted === null ? null : variancePaisa(counted, expectedPaisa);
  const warning = variance !== null && isVarianceWarning(variance, varianceWarnPaisa);
  const blocked = bills.length > 0;

  const showRefusal = (message: string) => {
    setRefusal(message);
    requestAnimationFrame(() => refusalRef.current?.focus());
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (pending || blocked || denominations === null) return;

    const parsed = parseCountForm(shiftId, list, { mode, counts, totalText, note });
    if (!parsed.ok) {
      setErrors(parsed.errors);
      setRefusal(null);
      return;
    }

    setErrors({ counts: {} });
    setRefusal(null);
    setPending(true);
    try {
      const result = await window.vendora.shifts.close(parsed.input);
      if (result.ok) {
        onClosed(result.report);
        return;
      }
      if (result.reason === "held-bills") {
        setBills(result.bills);
      } else if (result.reason === "unknown-denomination") {
        loadDenominations();
      } else {
        onChanged();
      }
      showRefusal(result.message);
    } catch (cause) {
      if (isSessionError(cause)) {
        onSessionEnded();
        return;
      }
      showRefusal(serviceErrorMessage);
    }
    setPending(false);
  };

  const onCountKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const step =
      event.key === "ArrowDown" || event.key === "Enter" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step === 0 || event.ctrlKey) return;
    const inputs = [
      ...(tableRef.current?.querySelectorAll<HTMLInputElement>("input[data-denomination-value]") ??
        []),
    ];
    const index = inputs.indexOf(event.currentTarget);
    event.preventDefault();
    const next = inputs[index + step];
    next?.focus();
    next?.select();
  };

  const onFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Enter" && event.ctrlKey) {
      event.preventDefault();
      void submit();
    }
  };

  const notes = list.filter((denomination) => denomination.kind === "note");
  const coins = list.filter((denomination) => denomination.kind === "coin");

  const countRow = (denomination: Denomination) => {
    const kindWord = denomination.kind === "note" ? "notes" : "coins";
    const text = counts[denomination.id] ?? "";
    const parsedCount = Number(text.trim() === "" ? "0" : text);
    const amount = Number.isSafeInteger(parsedCount) ? parsedCount * denomination.valuePaisa : 0;
    const error = errors.counts[denomination.id];
    return (
      <tr key={denomination.id} className="border-t border-line">
        <th
          scope="row"
          className="h-[var(--height-control-md)] px-400 text-left font-normal text-foreground"
        >
          {formatRupees(denomination.valuePaisa)}
        </th>
        <td className="px-400">
          <Field invalid={error !== undefined}>
            <Input
              data-denomination-value={denomination.valuePaisa}
              aria-label={`Count of ${formatRupees(denomination.valuePaisa)} ${kindWord}`}
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              className="w-[96px] text-right tabular-nums"
              value={text}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={onCountKeyDown}
              onChange={(event) =>
                setCounts((current) => ({ ...current, [denomination.id]: event.target.value }))
              }
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
        </td>
        <td className="px-400 text-right tabular-nums text-foreground">
          {error ? "" : formatRupees(amount)}
        </td>
      </tr>
    );
  };

  return (
    <form
      onSubmit={submit}
      onKeyDown={onFormKeyDown}
      noValidate
      aria-labelledby="close-shift-heading"
      className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] gap-800 p-800"
    >
      <div className="grid min-h-0 content-start gap-400 overflow-y-auto">
        <h1
          id="close-shift-heading"
          className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground"
        >
          Close shift
        </h1>
        <fieldset className="m-0 grid gap-200 border-0 p-0">
          <legend className="mb-200 p-0 text-[length:var(--font-size-400)] font-semibold text-foreground">
            Count cash
          </legend>
          <div role="radiogroup" aria-label="Count method" className="flex gap-200">
            {modes.map((option) => (
              <label
                key={option.value}
                className={cn(
                  "inline-flex min-h-[var(--height-control-md)] cursor-default items-center gap-200 rounded-100 border border-strong px-400 text-[length:var(--font-size-350)] text-foreground has-[:focus-visible]:shadow-focus",
                  mode === option.value ? "bg-surface-selected" : "bg-fill-secondary",
                )}
              >
                <input
                  type="radio"
                  name="count-method"
                  value={option.value}
                  checked={mode === option.value}
                  onChange={() => setMode(option.value)}
                  className="size-4 accent-[var(--color-bg-fill-brand)]"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
        {mode === "denominations" ? (
          denominations === null ? (
            loadFailed ? (
              <div className="grid justify-items-start gap-200">
                <ErrorLine>{serviceErrorMessage}</ErrorLine>
                <Button type="button" variant="secondary" onClick={loadDenominations}>
                  Retry
                </Button>
              </div>
            ) : (
              <p className="m-0 text-secondary">Loading…</p>
            )
          ) : (
            <div className="overflow-hidden rounded-300 border border-line-card bg-surface-secondary">
              <table
                ref={tableRef}
                className="w-full border-collapse text-[length:var(--font-size-350)]"
              >
                <thead>
                  <tr>
                    <th className="h-[32px] px-400 text-left text-[length:var(--font-size-300)] font-normal text-secondary">
                      Note/coin
                    </th>
                    <th className="h-[32px] px-400 text-left text-[length:var(--font-size-300)] font-normal text-secondary">
                      Count
                    </th>
                    <th className="h-[32px] px-400 text-right text-[length:var(--font-size-300)] font-normal text-secondary">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {notes.map(countRow)}
                  {coins.length > 0 ? (
                    <tr className="border-t border-line bg-surface">
                      <th
                        colSpan={3}
                        scope="colgroup"
                        className="h-[32px] px-400 text-left text-[length:var(--font-size-300)] font-normal text-secondary"
                      >
                        Coins
                      </th>
                    </tr>
                  ) : null}
                  {coins.map(countRow)}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <Field invalid={errors.total !== undefined} className="max-w-[320px]">
            <FieldLabel>Counted cash</FieldLabel>
            <AdornedInput
              name="countedCash"
              autoFocus
              inputMode="decimal"
              autoComplete="off"
              maxLength={16}
              lead="Rs"
              className="text-right tabular-nums"
              value={totalText}
              onChange={(event) => setTotalText(event.target.value)}
            />
            {errors.total ? <FieldError>{errors.total}</FieldError> : null}
          </Field>
        )}
      </div>
      <div className="grid min-h-0 content-start gap-400 overflow-y-auto">
        <section
          aria-label="Expected"
          className="grid gap-400 rounded-300 border border-line-card bg-surface-secondary p-600"
        >
          <div className="grid gap-050">
            <span className="text-[length:var(--font-size-300)] text-tertiary">
              Expected {expectedLabel}
            </span>
            <span className={figure}>{formatRupees(expectedPaisa)}</span>
          </div>
          <div className="grid gap-050">
            <span className="text-[length:var(--font-size-300)] text-tertiary">Counted</span>
            <span className={figure}>{counted === null ? "—" : formatRupees(counted)}</span>
          </div>
          <div className="grid gap-050">
            <span className="text-[length:var(--font-size-300)] text-tertiary">Variance</span>
            <span className={figure}>{variance === null ? "—" : varianceLabel(variance)}</span>
          </div>
          <div role="status" aria-live="polite">
            {warning && variance !== null ? (
              <p className="m-0 flex items-start gap-200 rounded-100 border border-line-warning bg-surface-warning p-300 text-[length:var(--font-size-350)] text-foreground">
                <TriangleAlertIcon
                  aria-hidden="true"
                  size={16}
                  strokeWidth={2}
                  className="mt-050 shrink-0 text-icon-warning"
                />
                Counted cash is {formatRupees(Math.abs(variance))}{" "}
                {variance < 0 ? "short of" : "over"} expected. Check the count before closing.
              </p>
            ) : null}
          </div>
        </section>
        {blocked ? (
          <section className="grid gap-200 rounded-300 bg-fill-highlight p-400 text-on-highlight">
            <h2 className="m-0 text-[length:var(--font-size-400)] font-semibold">
              {bills.length} {bills.length === 1 ? "bill" : "bills"} on hold
            </h2>
            <ul className="m-0 grid list-none gap-100 p-0 text-[length:var(--font-size-350)]">
              {bills.map((bill) => (
                <li key={bill.id} className="flex justify-between gap-400">
                  <span>
                    {bill.lineCount} {bill.lineCount === 1 ? "item" : "items"} ·{" "}
                    {bill.itemNames.join(", ")}
                  </span>
                  <span className="tabular-nums">{formatRupees(bill.totalPaisa)}</span>
                </li>
              ))}
            </ul>
            <p className="m-0 text-[length:var(--font-size-350)]">
              Resume or discard the held bills before closing.
            </p>
          </section>
        ) : null}
        <div ref={refusalRef} tabIndex={-1} className="outline-none focus-visible:shadow-focus">
          {refusal ? <ErrorLine>{refusal}</ErrorLine> : null}
        </div>
        <Field>
          <FieldLabel>Note (optional)</FieldLabel>
          <textarea
            name="note"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="w-full rounded-100 border border-strong border-b-input bg-fill-secondary p-300 text-[length:var(--font-size-350)] text-foreground outline-none placeholder:text-tertiary hover:bg-fill-secondary-hover focus-visible:border-b-line-brand focus-visible:bg-surface-secondary focus-visible:shadow-[inset_0_-1px_0_var(--color-border-brand)]"
          />
        </Field>
        <div className="grid grid-cols-2 gap-200">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
            <Kbd>Esc</Kbd>
          </Button>
          <Button type="submit" disabled={pending || blocked || denominations === null}>
            {pending ? "Closing…" : "Close shift"}
            <Kbd>Ctrl+Enter</Kbd>
          </Button>
        </div>
      </div>
    </form>
  );
}
