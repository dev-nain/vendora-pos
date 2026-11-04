import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import {
  checkoutMessages,
  type Bill,
  type BillLine,
  type BillResult,
  type CompletedSale,
  type UpdateLineInput,
} from "@shared/checkout";
import type { ProductSearchItem } from "@shared/products";
import type { HeldBillSummary } from "@shared/shifts";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { parseRupees, rupeeInputText } from "../lib/money";
import { parseQuantityMilli, quantityInputText } from "../lib/quantity";
import { isTypingTarget } from "../products/product-list";
import type { Hint } from "../shell/hint-bar";
import { BillActions } from "./bill-actions";
import { isWeighedLine } from "./bill-format";
import { BillDiscountDialog } from "./bill-discount-dialog";
import { BillLines, type LineEditing } from "./bill-lines";
import { BillTotals } from "./bill-totals";
import { DiscardBillDialog } from "./discard-bill-dialog";
import { HeldBillsDialog } from "./held-bills-dialog";
import { discountInputText, parseDiscountInput, toggleDiscountKind } from "./discount-input";
import { MiscItemDialog } from "./misc-item-dialog";
import { moveSelection, selectAfter, selectAfterDelete } from "./line-selection";
import { backspace, freshField, typeKey, type NumpadMode } from "./numpad-entry";
import { Numpad } from "./numpad";
import { newPaymentDraft, type PaymentDraft } from "./payment-lines";
import { PaymentScreen } from "./payment-screen";
import { ReceiptScreen } from "./receipt-screen";
import { ProductGrid, type ProductGridHandle } from "./product-grid";
import { QuantityConfirmDialog } from "./quantity-confirm-dialog";
import { quantityGuardMessage } from "./quantity-guard";
import { createBurstDetector } from "./scan-burst";
import { notFoundMessage } from "./scan-input";
import { createScanQueue, type ScanOutcome, type ScanQueue } from "./scan-queue";
import { ScanField, useDebouncedValue } from "./scan-field";
import { playScanError, playScanOk } from "./scan-sounds";
import { WeightDialog, type WeighedProduct } from "./weight-dialog";

const SEARCH_DEBOUNCE_MS = 150;
const NOTICE_MS = 4000;

const idleHints = (miscEnabled: boolean): Hint[] => [
  ["F2", "Search"],
  ["F3", "Qty"],
  ["F4", "Discount"],
  ["Shift+F4", "Bill discount"],
  ["F5", "Price"],
  ["F10", "Hold"],
  ["F11", "Held bills"],
  ["F12", "Pay"],
  ["Del", "Delete line"],
  ["Ctrl+Del", "Discard"],
  ...(miscEnabled ? ([["Ctrl+M", "Misc item"]] as Hint[]) : []),
  ["Ctrl+L", "Switch user"],
];

const paymentHints: Hint[] = [
  ["F2–F6", "Method"],
  ["F7", "Exact"],
  ["F8–F10", "500 / 1000 / 5000"],
  ["F11", "Buyer details"],
  ["Del", "Remove line"],
  ["Enter", "Validate"],
  ["Esc", "Back"],
  ["Ctrl+L", "Switch user"],
];

const receiptHints: Hint[] = [
  ["Enter", "New bill"],
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

export type BillingStep = "products" | "payment" | "receipt";

type Step = { name: "products" } | { name: "payment" } | { name: "receipt"; sale: CompletedSale };

interface View {
  bill: Bill | null;
  selectedId: string | null;
}

type Editing = { mode: NumpadMode } & Omit<LineEditing, "mode">;

type Prompt =
  | { kind: "weight"; product: WeighedProduct; initialText: string; fromScan: boolean }
  | { kind: "confirm-qty"; message: string; onConfirm: () => void; onCancel: () => void }
  | { kind: "bill-discount" }
  | { kind: "misc" }
  | { kind: "held" }
  | { kind: "discard-bill" }
  | { kind: "discard-held"; bill: HeldBillSummary };

function restoreField(field: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

interface BillingScreenProps {
  active: boolean;
  onSessionEnded: () => void;
  onHintsChange: (hints: Hint[]) => void;
  onStepChange: (step: BillingStep) => void;
}

const fieldUnit = (line: BillLine) => (isWeighedLine(line) ? line.unit : "piece");

const allowsDecimal = (mode: NumpadMode, line: BillLine) => mode !== "qty" || isWeighedLine(line);

export function BillingScreen({
  active,
  onSessionEnded,
  onHintsChange,
  onStepChange,
}: BillingScreenProps) {
  const [view, setView] = useState<View>({ bill: null, selectedId: null });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [searchText, setSearchText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [hasResults, setHasResults] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [miscEnabled, setMiscEnabled] = useState(false);
  const [heldCount, setHeldCount] = useState(0);
  const [stepState, setStepState] = useState<Step>({ name: "products" });
  const step = stepState.name;
  const [paymentState, setPayment] = useState<PaymentDraft | null>(null);
  const query = useDebouncedValue(searchText, SEARCH_DEBOUNCE_MS);

  const scanRef = useRef<HTMLInputElement | null>(null);
  const gridRef = useRef<ProductGridHandle | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committing = useRef(false);
  const processScan = useRef<(code: string) => Promise<ScanOutcome>>(async () => "continue");
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});

  const queue = useRef<ScanQueue | null>(null);

  const payment = paymentState?.draftId === view.bill?.id ? paymentState : null;

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

  const refreshHeld = useCallback(() => {
    window.vendora.checkout
      .listHeld()
      .then((bills) => setHeldCount(bills.length))
      .catch(fail);
  }, [fail]);

  useEffect(refreshHeld, [refreshHeld]);

  useEffect(() => {
    window.vendora.settings
      .getMiscItemEnabled()
      .then(({ enabled }) => setMiscEnabled(enabled))
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
        } else if (result.reason === "needs-weight" && result.product.unit !== "piece") {
          setPrompt({
            kind: "weight",
            product: { ...result.product, unit: result.product.unit },
            initialText: "",
            fromScan: true,
          });
          return "pause";
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

  const closePrompt = useCallback(() => {
    setPrompt(null);
    focusScan();
  }, [focusScan]);

  const addFromGrid = useCallback(
    (item: ProductSearchItem) => {
      if (item.unit !== "piece") {
        setPrompt({
          kind: "weight",
          product: {
            id: item.id,
            name: item.nameEn,
            nameUr: item.nameUr,
            unit: item.unit,
            unitPricePaisa: item.salePricePaisa,
          },
          initialText: "",
          fromScan: false,
        });
        return;
      }
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

  const addWeighed = useCallback(
    async (product: WeighedProduct, qtyMilli: number, fromScan: boolean) => {
      try {
        const result = await window.vendora.checkout.addProduct({
          productId: product.id,
          qtyMilli,
        });
        if (applyResult(result) && fromScan) playScanOk();
        else if (!result.ok && fromScan) playScanError();
      } catch (cause) {
        fail(cause);
      }
      closePrompt();
    },
    [applyResult, closePrompt, fail],
  );

  const submitWeight = (product: WeighedProduct, qtyMilli: number, fromScan: boolean) => {
    const message = quantityGuardMessage({
      name: product.name,
      unit: product.unit,
      packQtyMilli: 1000,
      qtyMilli,
      unitPricePaisa: product.unitPricePaisa,
    });
    if (message === null) {
      void addWeighed(product, qtyMilli, fromScan);
      return;
    }
    setPrompt({
      kind: "confirm-qty",
      message,
      onConfirm: () => void addWeighed(product, qtyMilli, fromScan),
      onCancel: () =>
        setPrompt({
          kind: "weight",
          product,
          initialText: quantityInputText(qtyMilli, product.unit),
          fromScan,
        }),
    });
  };

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

  const submitChange = useCallback(
    async (lineId: string, change: Omit<UpdateLineInput, "lineId">) => {
      if (committing.current) return;
      committing.current = true;
      try {
        const result = await window.vendora.checkout.updateLine({ lineId, ...change });
        if (result.ok) {
          applyBill(result.bill);
          closeEditing();
        } else {
          setEditing((current) => current && { ...current, error: result.message });
        }
      } catch (cause) {
        fail(cause);
      } finally {
        committing.current = false;
      }
    },
    [applyBill, closeEditing, fail],
  );

  const commit = useCallback(() => {
    if (!editing || !selectedLine) return;
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
      const message = quantityGuardMessage({
        name: line.name,
        unit: line.unit,
        packQtyMilli: line.packQtyMilli,
        qtyMilli: parsed.milli,
        unitPricePaisa: line.unitPricePaisa,
      });
      if (message !== null) {
        setPrompt({
          kind: "confirm-qty",
          message,
          onConfirm: () => {
            setPrompt(null);
            void submitChange(line.id, change);
          },
          onCancel: () => setPrompt(null),
        });
        return;
      }
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
    void submitChange(line.id, change);
  }, [editing, selectedLine, submitChange]);

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
      commit();
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

  const holdBill = async () => {
    const { bill } = view;
    if (!bill || bill.lines.length === 0) return;
    try {
      const result = await window.vendora.checkout.hold({ draftId: bill.id });
      if (result.ok) {
        setView({ bill: null, selectedId: null });
        setPayment(null);
        setEditing(null);
        refreshHeld();
      } else {
        showNotice(result.message);
      }
    } catch (cause) {
      fail(cause);
    }
    focusScan();
  };

  const openHeld = () => {
    setEditing(null);
    setPrompt({ kind: "held" });
  };

  const openDiscard = () => {
    if (!view.bill || view.bill.lines.length === 0) return;
    setEditing(null);
    setPrompt({ kind: "discard-bill" });
  };

  const openBillDiscount = () => {
    if (!view.bill || view.bill.lines.length === 0) return;
    setEditing(null);
    setPrompt({ kind: "bill-discount" });
  };

  const openMisc = () => {
    if (!miscEnabled) return;
    setEditing(null);
    setPrompt({ kind: "misc" });
  };

  const moveLine = (direction: 1 | -1) =>
    setView((prev) => ({
      ...prev,
      selectedId: moveSelection(prev.bill?.lines ?? [], prev.selectedId, direction),
    }));

  const canPay =
    view.bill !== null && view.bill.lines.length > 0 && view.bill.totals.totalPaisa >= 0;

  const openPayment = () => {
    const { bill } = view;
    if (!bill || !canPay || prompt !== null) return;
    setEditing(null);
    setPayment(payment ?? newPaymentDraft(bill.id));
    setStepState({ name: "payment" });
  };

  const closePayment = () => setStepState({ name: "products" });

  const startNewBill = useCallback((scannedCode?: string) => {
    setView({ bill: null, selectedId: null });
    setPayment(null);
    setStepState({ name: "products" });
    if (scannedCode !== undefined) queue.current?.enqueue(scannedCode);
  }, []);

  useEffect(() => {
    onStepChange(step);
    if (step === "products") focusScan();
  }, [step, onStepChange, focusScan]);

  useEffect(() => {
    keyHandler.current = (event) => {
      if (event.defaultPrevented || prompt !== null || step !== "products") return;
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
      } else if (event.key === "F4" && event.shiftKey) {
        event.preventDefault();
        openBillDiscount();
      } else if (event.key === "F4") {
        event.preventDefault();
        openEditing("discount");
      } else if (event.key === "F10") {
        void holdBill();
      } else if (event.key === "F11") {
        openHeld();
      } else if (event.key === "F5") {
        openEditing("price");
      } else if (event.key === "F12") {
        openPayment();
      }
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === "Delete") {
        event.preventDefault();
        openDiscard();
        return;
      }
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        openMisc();
        return;
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

  const promptOpen = prompt !== null;
  const editingOpen = editing !== null;

  useEffect(() => {
    if (promptOpen || editingOpen || step !== "products") queue.current?.pause();
    else queue.current?.resume();
  }, [promptOpen, editingOpen, step]);

  useEffect(() => {
    if (!active || (!promptOpen && !editingOpen)) return;
    const detector = createBurstDetector();
    let snapshot: { field: HTMLInputElement; value: string } | null = null;
    const onKeyDown = (event: KeyboardEvent) => {
      const result = detector.feed(event.key, event.timeStamp);
      const field = document.activeElement;
      if (result.startedBurst && field instanceof HTMLInputElement) {
        snapshot = { field, value: field.value };
      }
      if (result.scan === null) return;
      event.preventDefault();
      event.stopPropagation();
      if (snapshot) restoreField(snapshot.field, snapshot.value);
      queue.current?.enqueue(result.scan);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, promptOpen, editingOpen]);

  const idle = useMemo(() => idleHints(miscEnabled), [miscEnabled]);
  const hints =
    step === "receipt"
      ? receiptHints
      : step === "payment"
        ? paymentHints
        : editing
          ? editing.mode === "discount"
            ? discountEditingHints
            : editingHints
          : idle;

  useEffect(() => {
    onHintsChange(hints);
  }, [hints, onHintsChange]);

  const lines = view.bill?.lines ?? [];

  if (stepState.name === "receipt") {
    return <ReceiptScreen sale={stepState.sale} active={active} onNewBill={startNewBill} />;
  }

  if (step === "payment" && view.bill && payment) {
    return (
      <PaymentScreen
        bill={view.bill}
        draft={payment}
        active={active}
        onDraftChange={setPayment}
        onBack={closePayment}
        onCompleted={(sale) => setStepState({ name: "receipt", sale })}
        onSessionEnded={onSessionEnded}
      />
    );
  }

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
            onEnter={commit}
            onMode={(mode) => openEditing(mode)}
          />
          <div className="min-w-0 flex-1">
            <BillActions
              hasLines={lines.length > 0}
              canPay={canPay}
              miscEnabled={miscEnabled}
              heldCount={heldCount}
              onBillDiscount={openBillDiscount}
              onHold={() => void holdBill()}
              onHeldBills={openHeld}
              onMisc={openMisc}
              onDiscard={openDiscard}
              onPay={openPayment}
            />
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
      {prompt?.kind === "weight" ? (
        <WeightDialog
          product={prompt.product}
          initialText={prompt.initialText}
          returnFocus={scanRef}
          onSubmit={(qtyMilli) => submitWeight(prompt.product, qtyMilli, prompt.fromScan)}
          onCancel={closePrompt}
        />
      ) : null}
      {prompt?.kind === "confirm-qty" ? (
        <QuantityConfirmDialog
          message={prompt.message}
          onConfirm={prompt.onConfirm}
          onCancel={prompt.onCancel}
        />
      ) : null}
      {prompt?.kind === "bill-discount" && view.bill ? (
        <BillDiscountDialog
          bill={view.bill}
          returnFocus={scanRef}
          onApplied={(bill) => {
            applyBill(bill);
            closePrompt();
          }}
          onCancel={closePrompt}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
      {prompt?.kind === "held" ? (
        <HeldBillsDialog
          returnFocus={scanRef}
          onResumed={(bill) => {
            setView({ bill, selectedId: bill.lines.at(-1)?.id ?? null });
            setPayment(null);
            refreshHeld();
            closePrompt();
          }}
          onDiscard={(bill) => setPrompt({ kind: "discard-held", bill })}
          onClose={closePrompt}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
      {prompt?.kind === "discard-bill" && view.bill ? (
        <DiscardBillDialog
          draftId={view.bill.id}
          totalPaisa={view.bill.totals.totalPaisa}
          held={false}
          returnFocus={scanRef}
          onDiscarded={() => {
            setView({ bill: null, selectedId: null });
            setPayment(null);
            closePrompt();
          }}
          onCancel={closePrompt}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
      {prompt?.kind === "discard-held" ? (
        <DiscardBillDialog
          draftId={prompt.bill.id}
          totalPaisa={prompt.bill.totalPaisa}
          held
          returnFocus={scanRef}
          onDiscarded={() => {
            refreshHeld();
            setPrompt({ kind: "held" });
          }}
          onCancel={() => setPrompt({ kind: "held" })}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
      {prompt?.kind === "misc" ? (
        <MiscItemDialog
          returnFocus={scanRef}
          onAdded={(bill) => {
            applyBill(bill);
            closePrompt();
          }}
          onCancel={closePrompt}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
    </div>
  );
}
