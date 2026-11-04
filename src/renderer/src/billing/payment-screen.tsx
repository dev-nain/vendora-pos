import { ArrowLeftIcon, CheckIcon, CircleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  checkoutMessages,
  paymentMethodLabels,
  paymentMethods,
  type Bill,
  type CompletedSale,
  type PaymentMethod,
} from "@shared/checkout";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import { cn } from "@renderer/lib/utils";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { formatRupees } from "../lib/money";
import { LargePaymentDialog } from "./large-payment-dialog";
import { Numpad } from "./numpad";
import { amountInputId, PaymentLineList, referenceInputId } from "./payment-line-list";
import {
  backspaceAmount,
  moveSelected,
  paymentSummary,
  quickTender,
  removeSelected,
  selectOrAdd,
  setAmountText,
  setReference,
  toCompletePayload,
  typeAmount,
  validationIssue,
  type PaymentDraft,
  type TenderKind,
} from "./payment-lines";
import { PaymentHero, PaymentTotals } from "./payment-summary";
import { createBurstDetector } from "./scan-burst";
import { playScanError } from "./scan-sounds";

const NOTICE_MS = 4000;

const methodKeys: Record<string, PaymentMethod> = {
  F2: "cash",
  F3: "card",
  F4: "bank_transfer",
  F5: "jazzcash",
  F6: "easypaisa",
};

const methodKeycaps = Object.fromEntries(
  Object.entries(methodKeys).map(([key, method]) => [method, key]),
) as Record<PaymentMethod, string>;

const tenderKeys: Record<string, TenderKind> = {
  F7: "exact",
  F8: 50000,
  F9: 100000,
  F10: 500000,
};

const tenderButtons: { key: string; kind: TenderKind; label: string }[] = [
  { key: "F7", kind: "exact", label: "Exact" },
  { key: "F8", kind: 50000, label: "Rs 500" },
  { key: "F9", kind: 100000, label: "Rs 1,000" },
  { key: "F10", kind: 500000, label: "Rs 5,000" },
];

type FocusTarget =
  | { kind: "amount"; method: PaymentMethod }
  | { kind: "reference"; method: PaymentMethod }
  | { kind: "cash-button" };

interface PaymentScreenProps {
  bill: Bill;
  draft: PaymentDraft;
  active: boolean;
  onDraftChange: (draft: PaymentDraft) => void;
  onBack: () => void;
  onCompleted: (sale: CompletedSale) => void;
  onSessionEnded: () => void;
}

const cashButtonId = "pay-method-cash";

function restoreField(field: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

const isTextField = (target: EventTarget | null): target is HTMLInputElement =>
  target instanceof HTMLInputElement;

export function PaymentScreen({
  bill,
  draft,
  active,
  onDraftChange,
  onBack,
  onCompleted,
  onSessionEnded,
}: PaymentScreenProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ paidPaisa: number; totalPaisa: number } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locked = useRef(false);
  const [focusRequest, setFocusRequest] = useState<{ target: FocusTarget; n: number } | null>(null);
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});

  const summary = useMemo(() => paymentSummary(bill, draft.lines), [bill, draft.lines]);

  const focusOn = useCallback((target: FocusTarget) => {
    setFocusRequest((prev) => ({ target, n: (prev?.n ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    if (!focusRequest) return;
    const { target } = focusRequest;
    const id =
      target.kind === "amount"
        ? amountInputId(target.method)
        : target.kind === "reference"
          ? referenceInputId(target.method)
          : cashButtonId;
    document.getElementById(id)?.focus();
  }, [focusRequest]);

  const openedWith = useRef(draft.selected);
  useEffect(() => {
    focusOn(
      openedWith.current ? { kind: "amount", method: openedWith.current } : { kind: "cash-button" },
    );
  }, [focusOn]);

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

  const change = (next: PaymentDraft) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(null);
    onDraftChange(next);
  };

  const validate = async (confirmed = false) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      const issue = validationIssue(bill, draft);
      if (issue?.kind === "underpaid") {
        showNotice(`${formatRupees(issue.remainingPaisa)} left to pay`);
        return;
      }
      if (issue?.kind === "cash-not-rounded") {
        showNotice(checkoutMessages.cashNotRounded);
        focusOn({ kind: "amount", method: "cash" });
        return;
      }
      if (issue?.kind === "bad-amount") {
        showNotice("Enter the amount in rupees, like 500 or 500.50.");
        focusOn({ kind: "amount", method: issue.method });
        return;
      }
      if (issue?.kind === "too-large" && !confirmed) {
        setConfirm({ paidPaisa: issue.paidPaisa, totalPaisa: issue.totalPaisa });
        return;
      }
      const result = await window.vendora.checkout.complete(toCompletePayload(draft, undefined));
      if (result.ok) onCompleted(result.sale);
      else if (result.reason === "underpaid") {
        showNotice(`${formatRupees(result.duePaisa)} left to pay`);
      } else showNotice(result.message);
    } catch (cause) {
      if (isSessionError(cause)) onSessionEnded();
      else showNotice(serviceErrorMessage);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  const closeConfirm = () => {
    setConfirm(null);
    focusOn(
      draft.selected
        ? { kind: "amount", method: draft.selected }
        : { kind: "amount", method: "cash" },
    );
  };

  const addMethod = (method: PaymentMethod) => {
    const existed = draft.lines.some((line) => line.method === method);
    change(selectOrAdd(draft, bill, method));
    focusOn({
      kind: method === "cash" || existed ? "amount" : "reference",
      method,
    });
  };

  const tender = (kind: TenderKind) => {
    change(quickTender(draft, bill, kind));
    focusOn({ kind: "amount", method: "cash" });
  };

  const removeLine = () => {
    const next = removeSelected(draft);
    change(next);
    focusOn(next.selected ? { kind: "amount", method: next.selected } : { kind: "cash-button" });
  };

  const moveLine = (step: 1 | -1) => {
    const next = moveSelected(draft, step);
    change(next);
    if (next.selected) focusOn({ kind: "amount", method: next.selected });
  };

  useEffect(() => {
    keyHandler.current = (event) => {
      if (event.defaultPrevented || confirm !== null) return;
      const target = event.target as HTMLElement | null;
      const inReference = target?.id.startsWith("pay-reference-") ?? false;
      const inBuyer = target?.id.startsWith("buyer-") ?? false;
      const method = methodKeys[event.key];
      const kind = tenderKeys[event.key];
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      if (method) {
        event.preventDefault();
        addMethod(method);
      } else if (kind !== undefined) {
        event.preventDefault();
        tender(kind);
      } else if (event.key === "F11" || event.key === "F12") {
        event.preventDefault();
      } else if (event.key === "Enter") {
        if (target instanceof HTMLButtonElement) return;
        event.preventDefault();
        if (inReference && summary.remainingPaisa > 0 && draft.selected) {
          focusOn({ kind: "amount", method: draft.selected });
        } else {
          void validate();
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        onBack();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (inBuyer) return;
        event.preventDefault();
        moveLine(event.key === "ArrowDown" ? 1 : -1);
      } else if (event.key === "Delete") {
        if (inReference || inBuyer) return;
        event.preventDefault();
        removeLine();
      }
    };
  });

  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const detector = createBurstDetector();
    let snapshot: { field: HTMLInputElement; value: string } | null = null;
    const onKeyDown = (event: KeyboardEvent) => {
      const result = detector.feed(event.key, event.timeStamp);
      const field = document.activeElement;
      if (result.startedBurst && isTextField(field)) snapshot = { field, value: field.value };
      if (result.scan === null) return;
      event.preventDefault();
      event.stopPropagation();
      if (snapshot) restoreField(snapshot.field, snapshot.value);
      playScanError();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active]);

  const hasSelection = draft.selected !== null;
  const issue = validationIssue(bill, draft);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-[var(--height-row)] items-center gap-400 border-b border-line px-600">
        <Button variant="secondary" onClick={onBack}>
          <ArrowLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
          Back
          <Kbd>Esc</Kbd>
        </Button>
        <h1 className="m-0 text-[length:var(--font-size-550)] font-semibold text-foreground">
          Payment
        </h1>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_340px]">
        <section
          aria-label="Payment methods"
          className="flex min-h-0 flex-col gap-200 overflow-y-auto border-r border-line p-400"
        >
          {paymentMethods.map((method) => {
            const hasLine = draft.lines.some((line) => line.method === method);
            return (
              <Button
                key={method}
                id={`pay-method-${method}`}
                variant="secondary"
                size="lg"
                aria-pressed={draft.selected === method}
                className={cn("w-full justify-between px-400", hasLine && "bg-surface-selected")}
                onClick={() => addMethod(method)}
              >
                <span className="flex items-center gap-200">
                  {hasLine ? <CheckIcon aria-hidden="true" size={16} strokeWidth={2} /> : null}
                  {paymentMethodLabels[method]}
                </span>
                <Kbd>{methodKeycaps[method]}</Kbd>
              </Button>
            );
          })}
          <p className="m-0 mt-200 text-[length:var(--font-size-300)] text-tertiary">
            Quick tender
          </p>
          <div className="grid grid-cols-2 gap-200">
            {tenderButtons.map(({ key, kind, label }) => (
              <Button
                key={key}
                variant="secondary"
                size="lg"
                className="justify-between px-300"
                onClick={() => tender(kind)}
              >
                {label}
                <Kbd>{key}</Kbd>
              </Button>
            ))}
          </div>
        </section>
        <section
          aria-label="Payment lines"
          className="grid min-h-0 content-start gap-400 overflow-y-auto border-r border-line p-600"
        >
          <PaymentHero summary={summary} />
          <PaymentLineList
            lines={draft.lines}
            selected={draft.selected}
            onSelect={(method) => {
              if (draft.selected !== method) onDraftChange({ ...draft, selected: method });
            }}
            onActivate={(method) => {
              if (draft.selected !== method) onDraftChange({ ...draft, selected: method });
              focusOn({ kind: "amount", method });
            }}
            onAmountChange={(method, text) => change(setAmountText(draft, method, text))}
            onReferenceChange={(method, text) => change(setReference(draft, method, text))}
            onRemove={(method) => {
              const next = removeSelected({ ...draft, selected: method });
              change(next);
              focusOn(
                next.selected ? { kind: "amount", method: next.selected } : { kind: "cash-button" },
              );
            }}
          />
          {notice ? (
            <p role="alert" className="m-0 flex items-center gap-200 text-critical">
              <CircleAlertIcon aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
              {notice}
            </p>
          ) : null}
        </section>
        <section aria-label="Totals and keypad" className="flex min-h-0 flex-col gap-400 p-400">
          <PaymentTotals bill={bill} summary={summary} />
          <Numpad
            disabled={!hasSelection}
            onKey={(key) => change(typeAmount(draft, key))}
            onBackspace={() => change(backspaceAmount(draft))}
            onEnter={() => void validate()}
          />
          <Button
            size="lg"
            disabled={issue?.kind === "underpaid" || busy}
            aria-busy={busy}
            className="mt-auto w-full"
            onClick={() => void validate()}
          >
            Validate
            <Kbd>Enter</Kbd>
          </Button>
        </section>
      </div>
      {confirm ? (
        <LargePaymentDialog
          paidPaisa={confirm.paidPaisa}
          totalPaisa={confirm.totalPaisa}
          onConfirm={() => {
            setConfirm(null);
            void validate(true);
          }}
          onCancel={closeConfirm}
        />
      ) : null}
    </div>
  );
}
