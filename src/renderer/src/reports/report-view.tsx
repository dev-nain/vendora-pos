import {
  ChartColumnIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  PackageSearchIcon,
} from "lucide-react";
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
import { pageRangeLabel } from "../products/product-list";
import { ErrorLine } from "../users/form-parts";
import { DateRangeControl } from "./date-range-control";
import type { LoadedReport, ReportDefinition, ReportQuery } from "./report-definitions";
import { ReportProductField } from "./report-product-field";
import { ReportStocktakeSelect } from "./report-stocktake-select";
import { ReportTable } from "./report-table";

export const REPORT_PAGE_SIZE = 500;

interface ReportViewProps<
  Row extends Record<string, string | number>,
  Totals extends Record<string, number>,
> {
  definition: ReportDefinition<Row, Totals>;
  picker: ReactNode;
  onSessionEnded: () => void;
}

const rangeError = (from: string, to: string): string =>
  from !== "" && to !== "" && from > to
    ? "Start date must be on or before the end date."
    : "Enter a start and end date.";

const shortcuts: Record<string, ReportExportFormat> = { e: "csv", p: "pdf" };

export function ReportView<
  Row extends Record<string, string | number>,
  Totals extends Record<string, number>,
>({ definition, picker, onSessionEnded }: ReportViewProps<Row, Totals>) {
  const [preset, setPreset] = useState<ReportPreset>("today");
  const [initial] = useState(() => presetRange("today", new Date()));
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [productId, setProductId] = useState<string | null>(null);
  const [stocktakeId, setStocktakeId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    data: LoadedReport<Row, Totals> | null;
  } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [paging, setPaging] = useState({ key: "", page: 0 });
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const requestId = useRef(0);

  const isRange = definition.period === "range";
  const range = useMemo<ReportRange | null>(() => {
    const parsed = reportRangeSchema.safeParse({ from, to });
    return parsed.success ? parsed.data : null;
  }, [from, to]);
  const query = useMemo<ReportQuery | null>(() => {
    const effective = isRange ? range : initial;
    return effective ? { range: effective, productId, stocktakeId } : null;
  }, [isRange, range, initial, productId, stocktakeId]);
  const key = query
    ? JSON.stringify([isRange ? query.range : null, productId, stocktakeId, reloadKey])
    : null;

  const fail = useCallback(
    (cause: unknown) => {
      if (isSessionError(cause)) onSessionEnded();
      else setLoadFailed(true);
    },
    [onSessionEnded],
  );

  useEffect(() => {
    if (!query || !key) return;
    const id = ++requestId.current;
    Promise.resolve(definition.load(query))
      .then((data) => {
        if (id !== requestId.current) return;
        setLoaded({ key, data });
        setLoadFailed(false);
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        setLoaded({ key, data: null });
        fail(cause);
      });
  }, [query, key, definition, fail]);

  const data = loaded?.key === key ? loaded.data : (loaded?.data ?? null);
  const rows = data?.rows ?? [];
  const waiting = loaded !== null && loaded.key === key && loaded.data === null && !loadFailed;
  const canExport =
    query !== null && !exporting && loaded?.key === key && data !== null && rows.length > 0;
  const page = paging.key === key ? paging.page : 0;
  const pageRows = rows.slice(page * REPORT_PAGE_SIZE, (page + 1) * REPORT_PAGE_SIZE);

  const exportAs = useCallback(
    async (format: ReportExportFormat) => {
      if (!query || !canExport) return;
      const pending = definition.exportTo(query, format);
      if (pending === null) return;
      setExporting(true);
      setExportError(null);
      try {
        const outcome = await pending;
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
    [query, canExport, definition, onSessionEnded],
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

  const busy = key !== null && loaded?.key !== key;
  const caption = data?.caption ?? null;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto_auto_minmax(0,1fr)] gap-x-300 gap-y-500">
      <h1 className="col-start-1 row-start-1 m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
        Reports
      </h1>
      <div className="col-span-2 row-start-2 flex flex-wrap items-center gap-300">
        {picker}
        {isRange ? (
          <DateRangeControl
            preset={preset}
            from={from}
            to={to}
            error={range ? null : rangeError(from, to)}
            onPreset={choosePreset}
            onFromChange={setFrom}
            onToChange={setTo}
          />
        ) : null}
        {definition.subject === "product" ? (
          <ReportProductField onChange={setProductId} onSessionEnded={onSessionEnded} />
        ) : null}
        {definition.subject === "stocktake" ? (
          <ReportStocktakeSelect
            range={range}
            stocktakeId={stocktakeId}
            onChange={setStocktakeId}
            onSessionEnded={onSessionEnded}
          />
        ) : null}
      </div>
      <div className="col-start-2 row-start-1 flex items-center gap-200">
        {exportButton("csv", "Export CSV", "Ctrl+E")}
        {exportButton("pdf", "Export PDF", "Ctrl+P")}
      </div>
      <div className="col-span-2 row-start-3 grid gap-200">
        {isRange && range ? (
          <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
            {formatRangeLabel(range)} · Asia/Karachi time
          </p>
        ) : null}
        {caption ? (
          <p className="m-0 text-[length:var(--font-size-350)] text-secondary">{caption}</p>
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
      <div className="col-span-2 row-start-4 flex min-h-0 flex-col gap-300">
        {waiting ? (
          <div className="flex flex-col items-center gap-100 rounded-300 border border-line-card bg-surface-secondary py-1200 text-center">
            <PackageSearchIcon
              aria-hidden="true"
              size={24}
              strokeWidth={2}
              className="text-icon-muted"
            />
            <p className="m-0 text-secondary">{definition.waitingText ?? ""}</p>
          </div>
        ) : data === null ? (
          loadFailed ? null : (
            <p className="m-0 text-secondary">Loading…</p>
          )
        ) : rows.length === 0 ? (
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
            <p className="m-0 text-secondary">{definition.emptyHint}</p>
          </div>
        ) : (
          <>
            <ReportTable
              label={`${definition.label} table`}
              busy={busy}
              columns={definition.columns}
              rows={pageRows}
              offset={page * REPORT_PAGE_SIZE}
              totals={data.totals}
            />
            {rows.length > REPORT_PAGE_SIZE ? (
              <div className="flex items-center justify-between">
                <p className="m-0 text-[length:var(--font-size-350)] text-secondary tabular-nums">
                  {pageRangeLabel(page, pageRows.length, rows.length, REPORT_PAGE_SIZE)}
                </p>
                <div className="flex items-center gap-200">
                  <Button
                    variant="secondary"
                    disabled={page === 0}
                    focusableWhenDisabled
                    onClick={() => key && setPaging({ key, page: page - 1 })}
                  >
                    <ChevronLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={(page + 1) * REPORT_PAGE_SIZE >= rows.length}
                    focusableWhenDisabled
                    onClick={() => key && setPaging({ key, page: page + 1 })}
                  >
                    Next
                    <ChevronRightIcon aria-hidden="true" size={16} strokeWidth={2} />
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
