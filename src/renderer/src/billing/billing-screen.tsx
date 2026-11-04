import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import {
  checkoutMessages,
  type Bill,
  type BillLine,
  type BillResult,
  type UpdateLineInput,
} from "@shared/checkout";
import type { ProductSearchItem } from "@shared/products";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { parseRupees, rupeeInputText } from "../lib/money";
import { parseQuantityMilli, quantityInputText } from "../lib/quantity";
import { isTypingTarget } from "../products/product-list";
import type { Hint } from "../shell/hint-bar";
import { BillActions } from "./bill-actions";
import { isWeighedLine } from "./bill-format";
import { BillLines, type LineEditing } from "./bill-lines";
import { BillTotals } from "./bill-totals";
import { discountInputText, parseDiscountInput, toggleDiscountKind } from "./discount-input";
import { moveSelection, selectAfter, selectAfterDelete } from "./line-selection";
import { backspace, freshField, typeKey, type NumpadMode } from "./numpad-entry";
import { Numpad } from "./numpad";
import { ProductGrid, type ProductGridHandle } from "./product-grid";
import { notFoundMessage } from "./scan-input";
import { createScanQueue, type ScanOutcome, type ScanQueue } from "./scan-queue";
import { ScanField, useDebouncedValue } from "./scan-field";
import { playScanError, playScanOk } from "./scan-sounds";

const SEARCH_DEBOUNCE_MS = 150;
const NOTICE_MS = 4000;

const idleHints: Hint[] = [
  ["F2", "Search"],
  ["F3", "Qty"],
  ["F4", "Discount"],
  ["F5", "Price"],
  ["F12", "Pay"],
  ["Del", "Delete line"],
  ["Ctrl+L", "Switch user"],
];

const editingHints: Hint[] = [
  ["Enter", "Save"],
  ["Esc", "Cancel"],
  ["Ctrl+L", "Switch user"],
];

const discountEditingHints: Hint[] = [
  ["Enter", "Save"],
  ["Esc", "Cancel"],
  ["Tab", "Rs/%"],
  ["Ctrl+L", "Switch user"],
];

interface View {
  bill: Bill | null;
  selectedId: string | null;
}

type Editing = { mode: NumpadMode } & Omit<LineEditing, "mode">;

interface BillingScreenProps {
  active: boolean;
  onSessionEnded: () => void;
  onHintsChange: (hints: Hint[]) => void;
}

const fieldUnit = (line: BillLine) => (isWeighedLine(line) ? line.unit : "piece");

const allowsDecimal = (mode: NumpadMode, line: BillLine) => mode !== "qty" || isWeighedLine(line);

export function BillingScreen({ active, onSessionEnded, onHintsChange }: BillingScreenProps) {
  const [view, setView] = useState<View>({ bill: null, selectedId: null });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [searchText, setSearchText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [hasResults, setHasResults] = useState(false);
  const query = useDebouncedValue(searchText, SEARCH_DEBOUNCE_MS);

  const scanRef = useRef<HTMLInputElement | null>(null);
  const gridRef = useRef<ProductGridHandle | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committing = useRef(false);
  const processScan = useRef<(code: string) => Promise<ScanOutcome>>(async () => "continue");
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});

  const queue = useRef<ScanQueue | null>(null);

  const selectedLine = view.bill?.lines.find((line) => line.id === view.selectedId) ?? null;

  const focusScan = useCallback(() => scanRef.current?.focus(), []);

  const clearNotice = useCallback(() => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = null;
    setNotice(null);
  }, []);

  const showNotice = useCallback((text: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  const fail = useCallback(
    (cause: unknown) => {
      if (isSessionError(cause)) onSessionEnded();
      else showNotice(serviceErrorMessage);
    },
    [onSessionEnded, showNotice],
  );

  const applyBill = useCallback((next: Bill) => {
    setView((prev) => ({ bill: next, selectedId: selectAfter(prev.bill, next, prev.selectedId) }));
  }, []);

  const applyResult = useCallback(
    (result: BillResult): boolean => {
      if (result.ok) {
        applyBill(result.bill);
        return true;
      }
      showNotice(result.message);
      return false;
    },
    [applyBill, showNotice],
  );

  useEffect(() => {
    window.vendora.checkout
      .current()
      .then(({ bill }) => setView({ bill, selectedId: bill?.lines.at(-1)?.id ?? null }))
      .catch(fail);
  }, [fail]);

  useEffect(() => {
    queue.current = createScanQueue((code) => processScan.current(code));
  }, []);

  useEffect(() => {
    processScan.current = async (code) => {
      clearNotice();
      try {
        const result = await window.vendora.checkout.scan({ barcode: code });
        if (result.ok) {
          applyBill(result.bill);
          playScanOk();
        } else if (result.reason === "product-not-found") {
          showNotice(notFoundMessage(code));
          playScanError();
        } else {
          showNotice(result.message);
          playScanError();
        }
      } catch (cause) {
        fail(cause);
      }
      return "continue";
    };
  }, [applyBill, clearNotice, showNotice, fail]);

  const addFromGrid = useCallback(
    (item: ProductSearchItem) => {
      window.vendora.checkout
        .addProduct({ productId: item.id })
        .then((result) => {
          applyResult(result);
          focusScan();
        })
        .catch(fail);
    },
    [applyResult, fail, focusScan],
  );

  const closeEditing = useCallback(() => {
    setEditing(null);
    focusScan();
  }, [focusScan]);

  const openEditing = useCallback(
    (mode: NumpadMode, seed?: string) => {
      if (!selectedLine) return;
      if ((mode === "qty" || mode === "price") && selectedLine.scaleSource === "price") {
        showNotice(checkoutMessages.scaleLine);
        focusScan();
        return;
      }
      const text =
        mode === "qty"
          ? quantityInputText(Math.abs(selectedLine.qtyMilli), fieldUnit(selectedLine))
          : mode === "price"
            ? rupeeInputText(selectedLine.unitPricePaisa)
            : discountInputText(selectedLine.discount);
      setEditing({
        mode,
        field:
          seed === undefined
            ? freshField(text)
            : typeKey(freshField(""), seed, allowsDecimal(mode, selectedLine)),
        discountKind: selectedLine.discount?.kind ?? "percent",
        error: null,
      });
    },
    [selectedLine, showNotice, focusScan],
  );

  const deleteSelected = useCallback(async () => {
    const { bill } = view;
    if (!bill || !selectedLine) return;
    try {
      const result = await window.vendora.checkout.deleteLine(selectedLine.id);
      if (result.ok) {
        setView({
          bill: result.bill,
          selectedId: selectAfterDelete(bill.lines, selectedLine.id),
        });
        setEditing(null);
        focusScan();
      } else {
        showNotice(result.message);
      }
    } catch (cause) {
      fail(cause);
    }
  }, [view, selectedLine, focusScan, showNotice, fail]);

  const commit = useCallback(async () => {
    if (!editing || !selectedLine || committing.current) return;
    const line = selectedLine;
    const reject = (error: string) => setEditing((current) => current && { ...current, error });
    let change: Omit<UpdateLineInput, "lineId">;
    if (editing.mode === "qty") {
      const parsed = parseQuantityMilli(editing.field.text, fieldUnit(line));
      if (!parsed.ok || parsed.milli === 0) {
        reject("Enter a quantity above 0, or press Backspace to remove the line.");
        return;
      }
      change = { qtyMilli: parsed.milli };
    } else if (editing.mode === "price") {
      const parsed = parseRupees(editing.field.text);
      if (!parsed.ok) {
        reject("Enter a price in rupees.");
        return;
      }
      change = { unitPricePaisa: parsed.paisa };
    } else {
      const parsed = parseDiscountInput(editing.field.text, editing.discountKind);
      if (!parsed.ok) {
        reject(parsed.message);
        return;
      }
      change = { discount: parsed.discount };
    }

    committing.current = true;
    try {
      const result = await window.vendora.checkout.updateLine({ lineId: line.id, ...change });
      if (result.ok) {
        applyBill(result.bill);
        closeEditing();
      } else {
        reject(result.message);
      }
    } catch (cause) {
      fail(cause);
    } finally {
      committing.current = false;
    }
  }, [editing, selectedLine, applyBill, closeEditing, fail]);

  const pressBackspace = useCallback(() => {
    if (!editing) return;
    const outcome = backspace(editing.field, editing.mode);
    if (outcome.kind === "delete-line") void deleteSelected();
    else setEditing({ ...editing, field: outcome.state, error: null });
  }, [editing, deleteSelected]);

  const onFieldKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!editing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeEditing();
    } else if (event.key === "Tab" && editing.mode === "discount") {
      event.preventDefault();
      setEditing({ ...editing, discountKind: toggleDiscountKind(editing.discountKind) });
    } else if (event.key === "Backspace" && editing.mode === "qty") {
      event.preventDefault();
      pressBackspace();
    }
  };

  const pressKey = (key: string) => {
    if (!selectedLine) return;
    if (!editing) {
      openEditing("qty", key);
      return;
    }
    setEditing({
      ...editing,
      field: typeKey(editing.field, key, allowsDecimal(editing.mode, selectedLine)),
      error: null,
    });
  };

  const selectLine = (lineId: string) => {
    if (editing) setEditing(null);
    setView((prev) => ({ ...prev, selectedId: lineId }));
  };

  const moveLine = (step: 1 | -1) =>
    setView((prev) => ({
      ...prev,
      selectedId: moveSelection(prev.bill?.lines ?? [], prev.selectedId, step),
    }));

  useEffect(() => {
    keyHandler.current = (event) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const inScanField = target?.id === "scan-field";
      const plainTarget = !isTypingTarget(target) || (inScanField && searchText === "");

      if (["F5", "F10", "F11", "F12"].includes(event.key)) event.preventDefault();
      if (event.key === "F2") {
        event.preventDefault();
        setEditing(null);
        scanRef.current?.focus();
        scanRef.current?.select();
      } else if (event.key === "F3") {
        event.preventDefault();
        openEditing("qty");
      } else if (event.key === "F4" && !event.shiftKey) {
        event.preventDefault();
        openEditing("discount");
      } else if (event.key === "F5") {
        openEditing("price");
      }
      if (event.ctrlKey || event.altKey || event.metaKey || editing) return;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!plainTarget) return;
        event.preventDefault();
        moveLine(event.key === "ArrowDown" ? 1 : -1);
      } else if (event.key === "Delete") {
        if (!plainTarget) return;
        event.preventDefault();
        void deleteSelected();
      } else if (event.key.length === 1 && event.key !== " " && !isTypingTarget(target)) {
        event.preventDefault();
        setSearchText((text) => text + event.key);
        focusScan();
      }
    };
  });

  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [active]);

  const hints = editing
    ? editing.mode === "discount"
      ? discountEditingHints
      : editingHints
    : idleHints;

  useEffect(() => {
    onHintsChange(hints);
  }, [hints, onHintsChange]);

  const lines = view.bill?.lines ?? [];

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[45%_minmax(0,1fr)]">
      <section aria-label="Bill" className="flex min-h-0 flex-col border-r border-line">
        <BillLines
          lines={lines}
          selectedId={view.selectedId}
          editing={editing}
          onSelect={selectLine}
          onFieldChange={(text) =>
            setEditing(
              (current) => current && { ...current, field: { text, fresh: false }, error: null },
            )
          }
          onFieldKeyDown={onFieldKeyDown}
        />
        <BillTotals bill={view.bill} />
        <div className="flex items-end justify-between gap-400 border-t border-line px-600 py-300">
          <Numpad
            mode={editing?.mode ?? null}
            disabled={selectedLine === null}
            onKey={pressKey}
            onBackspace={pressBackspace}
            onEnter={() => void commit()}
            onMode={(mode) => openEditing(mode)}
          />
          <div className="min-w-0 flex-1">
            <BillActions />
          </div>
        </div>
      </section>
      <section aria-label="Find products" className="flex min-h-0 flex-col gap-300 p-400">
        <ScanField
          ref={scanRef}
          value={searchText}
          notice={notice}
          canMoveToGrid={hasResults}
          onChange={setSearchText}
          onSubmit={(code) => queue.current?.enqueue(code)}
          onMoveToGrid={() => gridRef.current?.focusFirst()}
          onDismissNotice={clearNotice}
        />
        <ProductGrid
          ref={gridRef}
          query={query}
          onAdd={addFromGrid}
          onReturnToScan={focusScan}
          onResultsChange={setHasResults}
          onSessionEnded={onSessionEnded}
        />
      </section>
    </div>
  );
}
