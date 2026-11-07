import { ChevronLeftIcon, ChevronRightIcon, ClipboardListIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import type { StocktakeLine, StocktakeSummary } from "@shared/stocktake";
import { Button } from "@renderer/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { createBurstDetector, restoreField } from "../billing/scan-burst";
import { ScanField, useDebouncedValue } from "../billing/scan-field";
import { isCodeLike, notFoundMessage } from "../billing/scan-input";
import { createScanQueue, type ScanOutcome, type ScanQueue } from "../billing/scan-queue";
import { playScanError, playScanOk } from "../billing/scan-sounds";
import { formatDateTime } from "../lib/date-time";
import { quantityInputText } from "../lib/quantity";
import { ProductNameCell, StatusBadge } from "../products/product-cells";
import { PRODUCT_PAGE_SIZE, pageRangeLabel } from "../products/product-list";
import { ErrorLine } from "../users/form-parts";
import { CancelStocktakeDialog } from "./cancel-stocktake-dialog";
import { onHandText } from "./stock-format";
import { StocktakeEntry, type EntryState } from "./stocktake-entry";
import { emptyCountMessage, packHint, readCountEntry } from "./stocktake-input";

const SEARCH_DEBOUNCE_MS = 150;

interface StocktakeCountProps {
  stocktake: StocktakeSummary;
  onClosed: () => void;
  onCancelled: () => void;
  onSessionEnded: () => void;
}

interface LinesPage {
  items: StocktakeLine[];
  total: number;
}

const negativeClass = (value: number): string => (value < 0 ? "text-critical" : "");

const notCounted = (
  <>
    <span aria-hidden="true" className="text-tertiary">
      —
    </span>
    <span className="sr-only">Not counted</span>
  </>
);

export function StocktakeCount({
  stocktake,
  onClosed,
  onCancelled,
  onSessionEnded,
}: StocktakeCountProps) {
  const [countedCount, setCountedCount] = useState(stocktake.countedCount);
  const [scanText, setScanText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pageState, setPageState] = useState({ query: "", page: 0 });
  const [activeIndex, setActiveIndex] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<LinesPage | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState<EntryState | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const scanRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const entryRef = useRef<EntryState | null>(null);
  const tokenRef = useRef(0);
  const requestId = useRef(0);
  const focusFirstRow = useRef(false);
  const queueRef = useRef<ScanQueue | null>(null);
  const processRef = useRef<(code: string) => Promise<ScanOutcome>>(async () => "continue");

  const stocktakeId = stocktake.id;
  const query = useDebouncedValue(scanText.trim(), SEARCH_DEBOUNCE_MS);
  const page = pageState.query === query ? pageState.page : 0;
  const items = result?.items ?? [];
  const total = result?.total ?? 0;
  const active = Math.min(activeIndex, Math.max(items.length - 1, 0));

  const fail = useCallback(
    (cause: unknown) => {
      if (isSessionError(cause)) {
        onSessionEnded();
        return;
      }
      setError(serviceErrorMessage);
    },
    [onSessionEnded],
  );

  const focusScan = useCallback((select = false) => {
    scanRef.current?.focus();
    if (select) scanRef.current?.select();
  }, []);

  const commitEntry = useCallback((next: EntryState | null) => {
    entryRef.current = next;
    setEntry(next);
  }, []);

  useEffect(() => {
    const id = ++requestId.current;
    const key = JSON.stringify([query, page, reloadKey]);
    window.vendora.stocktake
      .lines({
        stocktakeId,
        query,
        limit: PRODUCT_PAGE_SIZE,
        offset: page * PRODUCT_PAGE_SIZE,
      })
      .then((fetched) => {
        if (id !== requestId.current) return;
        if (!fetched.ok) {
          onClosed();
          return;
        }
        setResult({ items: fetched.items, total: fetched.total });
        setError(null);
        setLoadedKey(key);
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        setLoadedKey(key);
        fail(cause);
      });
  }, [stocktakeId, query, page, reloadKey, fail, onClosed]);

  useLayoutEffect(() => {
    if (!focusFirstRow.current || !result || result.items.length === 0) return;
    focusFirstRow.current = false;
    bodyRef.current?.querySelectorAll<HTMLElement>("tr")[0]?.focus();
  }, [result]);

  const focusRow = (index: number) => {
    setActiveIndex(index);
    bodyRef.current?.querySelectorAll<HTMLElement>("tr")[index]?.focus();
  };

  const openEntry = useCallback(
    (line: StocktakeLine, hint: string | null) => {
      const initialText =
        line.countedMilli === null ? "" : quantityInputText(line.countedMilli, line.unit);
      tokenRef.current += 1;
      setSaved(null);
      setNotice(null);
      commitEntry({
        token: tokenRef.current,
        line,
        hint,
        initialText,
        text: initialText,
        error: null,
        pending: false,
      });
    },
    [commitEntry],
  );

  const closeEntry = () => {
    commitEntry(null);
    focusScan();
  };

  const save = useCallback(async (): Promise<boolean> => {
    const current = entryRef.current;
    if (!current || current.pending) return false;
    const { line } = current;
    const read = readCountEntry(current.text, current.initialText, line.unit);

    let countedMilli: number;
    if (read.kind === "valid") {
      countedMilli = read.countedMilli;
    } else if (
      read.kind === "unchanged" &&
      current.initialText !== "" &&
      current.text === current.initialText &&
      line.countedMilli !== null
    ) {
      countedMilli = line.countedMilli;
    } else {
      commitEntry({
        ...current,
        error: read.kind === "invalid" ? read.message : emptyCountMessage(line.unit),
      });
      return false;
    }

    commitEntry({ ...current, pending: true, error: null });
    try {
      const recorded = await window.vendora.stocktake.record({
        stocktakeId,
        lineId: line.id,
        countedMilli,
      });
      if (recorded.ok) {
        setResult((previous) =>
          previous
            ? {
                ...previous,
                items: previous.items.map((item) => (item.id === line.id ? recorded.line : item)),
              }
            : previous,
        );
        setCountedCount(recorded.countedCount);
        setSaved(`Saved: ${line.nameEn}, ${onHandText(countedMilli, line.unit)}`);
        commitEntry(null);
        focusScan();
        return true;
      }
      if (recorded.reason === "not-open") {
        onClosed();
        return false;
      }
      if (recorded.reason === "not-found") setReloadKey((key) => key + 1);
      commitEntry({ ...current, pending: false, error: recorded.message });
    } catch (cause) {
      if (isSessionError(cause)) {
        onSessionEnded();
        return false;
      }
      commitEntry({ ...current, pending: false, error: serviceErrorMessage });
    }
    return false;
  }, [stocktakeId, commitEntry, focusScan, onClosed, onSessionEnded]);

  const processScan = useCallback(
    async (code: string): Promise<ScanOutcome> => {
      const open = entryRef.current;
      if (open) {
        const read = readCountEntry(open.text, open.initialText, open.line.unit);
        if (read.kind === "invalid") {
          commitEntry({ ...open, error: read.message });
          playScanError();
          return "continue";
        }
        if (read.kind === "valid" && !(await save())) {
          playScanError();
          return "continue";
        }
      }

      try {
        const scanned = await window.vendora.stocktake.scan({ stocktakeId, barcode: code });
        if (scanned.ok) {
          playScanOk();
          openEntry(scanned.line, packHint(scanned.packQtyMilli, scanned.line.unit));
        } else if (scanned.reason === "not-open") {
          onClosed();
        } else {
          setNotice(scanned.message);
          playScanError();
          focusScan();
        }
      } catch (cause) {
        if (isSessionError(cause)) onSessionEnded();
        else {
          setNotice(serviceErrorMessage);
          focusScan();
        }
      }
      return "continue";
    },
    [stocktakeId, commitEntry, save, openEntry, focusScan, onClosed, onSessionEnded],
  );

  useEffect(() => {
    processRef.current = processScan;
  }, [processScan]);

  useEffect(() => {
    queueRef.current = createScanQueue((code) => processRef.current(code));
  }, []);

  const searchByText = async (text: string) => {
    try {
      const fetched = await window.vendora.stocktake.lines({
        stocktakeId,
        query: text,
        limit: PRODUCT_PAGE_SIZE,
        offset: 0,
      });
      if (!fetched.ok) {
        onClosed();
        return;
      }
      setResult({ items: fetched.items, total: fetched.total });
      const [only] = fetched.items;
      if (fetched.total === 1 && only) {
        openEntry(only, null);
      } else if (fetched.total > 1) {
        focusFirstRow.current = true;
      } else {
        setNotice(notFoundMessage(text));
        playScanError();
      }
    } catch (cause) {
      fail(cause);
    }
  };

  const submitScanField = (text: string) => {
    setNotice(null);
    if (isCodeLike(text)) {
      queueRef.current?.enqueue(text);
      return;
    }
    setScanText(text);
    void searchByText(text);
  };

  useEffect(() => {
    if (cancelling) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const isFind = event.ctrlKey && !event.altKey && !event.metaKey && event.key === "f";
      if (event.key !== "F2" && !isFind) return;
      event.preventDefault();
      focusScan(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelling, focusScan]);

  useEffect(() => {
    if (cancelling) return;
    const detector = createBurstDetector();
    let snapshot: { field: HTMLInputElement; value: string } | null = null;
    const onKeyDown = (event: KeyboardEvent) => {
      const field = document.activeElement;
      if (field === scanRef.current) return;
      const burst = detector.feed(event.key, event.timeStamp);
      if (burst.startedBurst && field instanceof HTMLInputElement) {
        snapshot = { field, value: field.value };
      }
      if (burst.scan === null) return;
      event.preventDefault();
      event.stopPropagation();
      if (snapshot) restoreField(snapshot.field, snapshot.value);
      queueRef.current?.enqueue(burst.scan);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [cancelling]);

  const onRowKeyDown = (event: ReactKeyboardEvent<HTMLTableRowElement>, index: number) => {
    if (event.target !== event.currentTarget) return;
    const last = items.length - 1;
    const target =
      event.key === "ArrowDown"
        ? Math.min(index + 1, last)
        : event.key === "ArrowUp"
          ? Math.max(index - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    const line = items[index];
    if (target !== null) {
      event.preventDefault();
      focusRow(target);
    } else if (event.key === "Enter" && line) {
      event.preventDefault();
      openEntry(line, null);
    }
  };

  const changePage = (next: number) => {
    setPageState({ query, page: next });
    setActiveIndex(0);
  };

  const scopeText =
    stocktake.scope === "full" ? "Full count" : `Category: ${stocktake.categoryName ?? ""}`;

  return (
    <div className="flex flex-col gap-400">
      <div className="flex items-start justify-between gap-400">
        <div className="grid gap-100">
          <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
            Stocktake
          </h1>
          <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
            {scopeText}. Started {formatDateTime(stocktake.startedAt)} by {stocktake.startedByName}.
            Saved as you go.
          </p>
          <p className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground tabular-nums">
            {countedCount} of {stocktake.lineCount} counted
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={() => setCancelling(true)}>
          Cancel count
        </Button>
      </div>
      <div className="sticky top-0 z-10 grid gap-200 bg-surface pb-200">
        <ScanField
          ref={scanRef}
          value={scanText}
          notice={notice}
          canMoveToGrid={items.length > 0}
          onChange={(next) => {
            setScanText(next);
            setNotice(null);
          }}
          onSubmit={submitScanField}
          onMoveToGrid={() => focusRow(0)}
          onDismissNotice={() => setNotice(null)}
        />
        <StocktakeEntry
          entry={entry}
          saved={saved}
          onTextChange={(text) => {
            const current = entryRef.current;
            if (current) commitEntry({ ...current, text, error: null });
          }}
          onSave={() => void save()}
          onClose={closeEntry}
        />
      </div>
      {error ? (
        <div className="flex items-center gap-300">
          <ErrorLine>{error}</ErrorLine>
          <Button variant="secondary" onClick={() => setReloadKey((key) => key + 1)}>
            Try again
          </Button>
        </div>
      ) : null}
      {result === null ? (
        error ? null : (
          <p className="m-0 text-secondary">Loading…</p>
        )
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-100 rounded-300 border border-line-card bg-surface-secondary py-1200 text-center">
          <ClipboardListIcon
            aria-hidden="true"
            size={24}
            strokeWidth={2}
            className="text-icon-muted"
          />
          <p className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground">
            No products match
          </p>
          <p className="m-0 text-secondary">Try a different name, Urdu name or code.</p>
        </div>
      ) : (
        <Table
          className="table-fixed"
          aria-label="Count"
          aria-busy={loadedKey !== JSON.stringify([query, page, reloadKey])}
        >
          <colgroup>
            <col />
            <col className="w-[160px]" />
            <col className="w-[120px]" />
            <col className="w-[120px]" />
            <col className="w-[176px]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Counted</TableHead>
              <TableHead>Counted at</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody ref={bodyRef}>
            {items.map((item, index) => (
              <TableRow
                key={item.id}
                tabIndex={index === active ? 0 : -1}
                aria-selected={index === active}
                className="cursor-pointer outline-none focus-visible:shadow-focus"
                onFocus={() => setActiveIndex(index)}
                onClick={() => openEntry(item, null)}
                onKeyDown={(event) => onRowKeyDown(event, index)}
              >
                <TableCell className="py-100">
                  <ProductNameCell item={item} />
                  {item.isActive ? null : <StatusBadge isActive={false} />}
                </TableCell>
                <TableCell className="truncate" title={item.categoryName}>
                  {item.categoryName}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${negativeClass(item.onHandMilli)}`}>
                  {onHandText(item.onHandMilli, item.unit)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.countedMilli === null
                    ? notCounted
                    : onHandText(item.countedMilli, item.unit)}
                </TableCell>
                <TableCell>
                  {item.countedAt ? formatDateTime(item.countedAt) : notCounted}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {total > PRODUCT_PAGE_SIZE ? (
        <div className="flex items-center justify-between">
          <p className="m-0 text-[length:var(--font-size-350)] text-secondary tabular-nums">
            {pageRangeLabel(page, items.length, total)}
          </p>
          <div className="flex items-center gap-200">
            <Button
              variant="secondary"
              disabled={page === 0}
              focusableWhenDisabled
              onClick={() => changePage(page - 1)}
            >
              <ChevronLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={(page + 1) * PRODUCT_PAGE_SIZE >= total}
              focusableWhenDisabled
              onClick={() => changePage(page + 1)}
            >
              Next
              <ChevronRightIcon aria-hidden="true" size={16} strokeWidth={2} />
            </Button>
          </div>
        </div>
      ) : null}
      {cancelling ? (
        <CancelStocktakeDialog
          stocktakeId={stocktakeId}
          countedCount={countedCount}
          returnFocus={scanRef}
          onCancelled={onCancelled}
          onKeep={() => setCancelling(false)}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
    </div>
  );
}
