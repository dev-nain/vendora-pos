import { ChartColumnIcon, DownloadIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import {
  exportReportFailedMessage,
  formatRangeLabel,
  presetRange,
  reportRangeSchema,
  type ReportExportFormat,
  type ReportPreset,
  type ReportRange,
} from "@shared/reports";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { ErrorLine } from "../users/form-parts";
import { DateRangeControl } from "./date-range-control";
import type { ReportDefinition } from "./report-definitions";

interface ReportViewProps<Result> {
  definition: ReportDefinition<Result>;
  picker: ReactNode;
  onSessionEnded: () => void;
  onOpenSale?: ((invoiceNo: string) => void) | undefined;
}

const rangeError = (from: string, to: string): string =>
  from !== "" && to !== "" && from > to
    ? "Start date must be on or before the end date."
    : "Enter a start and end date.";

const shortcuts: Record<string, ReportExportFormat> = { e: "csv", p: "pdf" };

export function ReportView<Result>({
  definition,
  picker,
  onSessionEnded,
  onOpenSale,
}: ReportViewProps<Result>) {
  const [preset, setPreset] = useState<ReportPreset>("today");
  const [initial] = useState(() => presetRange("today", new Date()));
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const requestId = useRef(0);

  const range = useMemo<ReportRange | null>(() => {
    const parsed = reportRangeSchema.safeParse({ from, to });
    return parsed.success ? parsed.data : null;
  }, [from, to]);
  const key = range ? JSON.stringify([range, reloadKey]) : null;

  const fail = useCallback(
    (cause: unknown) => {
      if (isSessionError(cause)) onSessionEnded();
      else setLoadFailed(true);
    },
    [onSessionEnded],
  );

  useEffect(() => {
    if (!range || !key) return;
    const id = ++requestId.current;
    definition
      .load(range)
      .then((loaded) => {
        if (id !== requestId.current) return;
        setResult(loaded);
        setLoadFailed(false);
        setLoadedKey(key);
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        setLoadedKey(key);
        fail(cause);
      });
  }, [range, key, definition, fail]);

  const canExport =
    range !== null &&
    !exporting &&
    loadedKey === key &&
    result !== null &&
    !definition.isEmpty(result);

  const exportAs = useCallback(
    async (format: ReportExportFormat) => {
      if (!range || !canExport) return;
      setExporting(true);
      setExportError(null);
      try {
        const outcome = await definition.exportTo({ range, format });
        if (outcome.ok && outcome.status === "saved")
          setExportMessage(`Report saved to ${outcome.path}.`);
        else if (!outcome.ok) {
          setExportMessage(null);
          setExportError(outcome.message);
        }
      } catch (cause) {
        if (isSessionError(cause)) onSessionEnded();
        else {
          setExportMessage(null);
          setExportError(exportReportFailedMessage);
        }
      } finally {
        setExporting(false);
      }
    },
    [range, canExport, definition, onSessionEnded],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const format = shortcuts[event.key.toLowerCase()];
      if (!format) return;
      event.preventDefault();
      void exportAs(format);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exportAs]);

  const choosePreset = (next: ReportPreset) => {
    setPreset(next);
    if (next === "custom") return;
    const nextRange = presetRange(next, new Date());
    setFrom(nextRange.from);
    setTo(nextRange.to);
  };

  const exportButton = (format: ReportExportFormat, label: string, shortcut: string) => (
    <Button
      variant="secondary"
      disabled={!canExport}
      focusableWhenDisabled
      aria-busy={exporting}
      onClick={() => void exportAs(format)}
    >
      <DownloadIcon aria-hidden="true" size={16} strokeWidth={2} />
      {exporting ? "Exporting…" : label}
      <Kbd>{shortcut}</Kbd>
    </Button>
  );

  const busy = key !== null && loadedKey !== key;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto_auto_minmax(0,1fr)] gap-x-300 gap-y-500">
      <h1 className="col-start-1 row-start-1 m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
        Reports
      </h1>
      <div className="col-span-2 row-start-2 flex flex-wrap items-center gap-300">
        {picker}
        <DateRangeControl
          preset={preset}
          from={from}
          to={to}
          error={range ? null : rangeError(from, to)}
          onPreset={choosePreset}
          onFromChange={setFrom}
          onToChange={setTo}
        />
      </div>
      <div className="col-start-2 row-start-1 flex items-center gap-200">
        {exportButton("csv", "Export CSV", "Ctrl+E")}
        {exportButton("pdf", "Export PDF", "Ctrl+P")}
      </div>
      <div className="col-span-2 row-start-3 grid gap-200">
        {range ? (
          <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
            {formatRangeLabel(range)} · Asia/Karachi time
          </p>
        ) : null}
        {exportMessage ? (
          <p role="status" className="m-0 text-[length:var(--font-size-350)] text-secondary">
            {exportMessage}
          </p>
        ) : null}
        {exportError ? <ErrorLine>{exportError}</ErrorLine> : null}
        {loadFailed ? (
          <div className="flex items-center gap-300">
            <ErrorLine>{serviceErrorMessage}</ErrorLine>
            <Button variant="secondary" onClick={() => setReloadKey((value) => value + 1)}>
              Try again
            </Button>
          </div>
        ) : null}
      </div>
      <div className="col-span-2 row-start-4 flex min-h-0 flex-col">
        {result === null ? (
          loadFailed ? null : (
            <p className="m-0 text-secondary">Loading…</p>
          )
        ) : definition.isEmpty(result) ? (
          <div className="flex flex-col items-center gap-100 rounded-300 border border-line-card bg-surface-secondary py-1200 text-center">
            <ChartColumnIcon
              aria-hidden="true"
              size={24}
              strokeWidth={2}
              className="text-icon-muted"
            />
            <p className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground">
              {definition.emptyTitle}
            </p>
            <p className="m-0 text-secondary">Try another date range.</p>
          </div>
        ) : (
          <definition.Body result={result} busy={busy} onOpenSale={onOpenSale} />
        )}
      </div>
    </div>
  );
}
