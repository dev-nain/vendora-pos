import type { Bill, BuyerInput, CompleteSaleInput, PaymentMethod } from "@shared/checkout";
import { roundToUnit, tenderRoundingPaisa, type TenderInput } from "@shared/rounding";
import { parseRupees, rupeeInputText } from "../lib/money";
import { emptyBuyerText, type BuyerText } from "./buyer-input";
import { backspace, freshField, typeKey, type FieldState } from "./numpad-entry";

export type PaymentLine = {
  method: PaymentMethod;
  amount: FieldState;
  reference: string;
  tenderRun: boolean;
};

export type PaymentDraft = {
  draftId: string;
  lines: PaymentLine[];
  selected: PaymentMethod | null;
  buyer: BuyerText;
  buyerOpen: boolean;
};

export type TenderKind = "exact" | 50000 | 100000 | 500000;

export type PaymentSummary = {
  preTotalPaisa: number;
  roundingPaisa: number;
  totalPaisa: number;
  paidPaisa: number;
  remainingPaisa: number;
  changePaisa: number;
};

export type ValidationIssue =
  | { kind: "underpaid"; remainingPaisa: number }
  | { kind: "cash-not-rounded" }
  | { kind: "bad-amount"; method: PaymentMethod }
  | { kind: "too-large"; paidPaisa: number; totalPaisa: number };

const largePaymentFactor = 1000;

export const newPaymentDraft = (draftId: string): PaymentDraft => ({
  draftId,
  lines: [],
  selected: null,
  buyer: emptyBuyerText(),
  buyerOpen: false,
});

export function amountPaisa(line: PaymentLine): number {
  const parsed = parseRupees(line.amount.text);
  return parsed.ok ? parsed.paisa : 0;
}

const tendersOf = (lines: readonly PaymentLine[]): TenderInput[] =>
  lines
    .map((line) => ({ method: line.method, amountPaisa: amountPaisa(line) }))
    .filter((tender) => tender.amountPaisa > 0);

export function paymentSummary(bill: Bill, lines: readonly PaymentLine[]): PaymentSummary {
  const preTotalPaisa = bill.totals.totalPaisa - bill.totals.roundingPaisa;
  const tenders = tendersOf(lines);
  const roundingPaisa = tenderRoundingPaisa(preTotalPaisa, bill.cashRounding, tenders);
  const totalPaisa = preTotalPaisa + roundingPaisa;
  const paidPaisa = tenders.reduce((sum, tender) => sum + tender.amountPaisa, 0);
  return {
    preTotalPaisa,
    roundingPaisa,
    totalPaisa,
    paidPaisa,
    remainingPaisa: Math.max(0, totalPaisa - paidPaisa),
    changePaisa: Math.max(0, paidPaisa - totalPaisa),
  };
}

const roundUpToUnit = (paisa: number, unitPaisa: number): number =>
  Math.floor((paisa + unitPaisa - 1) / unitPaisa) * unitPaisa;

export function suggestedAmountPaisa(
  bill: Bill,
  lines: readonly PaymentLine[],
  method: PaymentMethod,
): number {
  const others = lines.filter((line) => line.method !== method);
  if (method !== "cash") {
    return Math.max(0, paymentSummary(bill, others).remainingPaisa);
  }
  const nonCashPaid = tendersOf(others).reduce((sum, tender) => sum + tender.amountPaisa, 0);
  const { mode, unitPaisa } = bill.cashRounding;
  const preTotal = bill.totals.totalPaisa - bill.totals.roundingPaisa;
  if (mode === "off") return Math.max(0, preTotal - nonCashPaid);
  if (mode === "every-bill") {
    return roundUpToUnit(Math.max(0, bill.totals.totalPaisa - nonCashPaid), unitPaisa);
  }
  const cashDue = preTotal - nonCashPaid;
  return cashDue <= 0 ? 0 : roundToUnit(cashDue, unitPaisa);
}

const withLine = (
  draft: PaymentDraft,
  method: PaymentMethod,
  update: (line: PaymentLine) => PaymentLine,
): PaymentLine[] => draft.lines.map((line) => (line.method === method ? update(line) : line));

const endTenderRun = (lines: PaymentLine[]): PaymentLine[] =>
  lines.map((line) => (line.tenderRun ? { ...line, tenderRun: false } : line));

export function selectOrAdd(draft: PaymentDraft, bill: Bill, method: PaymentMethod): PaymentDraft {
  if (draft.lines.some((line) => line.method === method)) return { ...draft, selected: method };
  const amount = suggestedAmountPaisa(bill, draft.lines, method);
  const line: PaymentLine = {
    method,
    amount: freshField(rupeeInputText(amount)),
    reference: "",
    tenderRun: false,
  };
  return { ...draft, lines: [...endTenderRun(draft.lines), line], selected: method };
}

export function quickTender(draft: PaymentDraft, bill: Bill, kind: TenderKind): PaymentDraft {
  const existing = draft.lines.find((line) => line.method === "cash");
  const base: PaymentDraft = existing
    ? draft
    : {
        ...draft,
        lines: [
          ...draft.lines,
          { method: "cash", amount: freshField("0"), reference: "", tenderRun: false },
        ],
      };
  const lines = withLine(base, "cash", (line) => {
    if (kind === "exact") {
      const amount = suggestedAmountPaisa(bill, base.lines, "cash");
      return { ...line, amount: freshField(rupeeInputText(amount)), tenderRun: false };
    }
    const next = line.tenderRun ? amountPaisa(line) + kind : kind;
    return { ...line, amount: freshField(rupeeInputText(next)), tenderRun: true };
  });
  return { ...base, lines, selected: "cash" };
}

export function typeAmount(draft: PaymentDraft, key: string): PaymentDraft {
  if (draft.selected === null) return draft;
  const lines = withLine(draft, draft.selected, (line) => ({
    ...line,
    amount: typeKey(line.amount, key, true),
    tenderRun: false,
  }));
  return { ...draft, lines };
}

const amountTextPattern = /^\d{0,13}(\.\d{0,2})?$/;

export function setAmountText(
  draft: PaymentDraft,
  method: PaymentMethod,
  text: string,
): PaymentDraft {
  if (!amountTextPattern.test(text)) return draft;
  return {
    ...draft,
    lines: withLine(draft, method, (line) => ({
      ...line,
      amount: { text, fresh: false },
      tenderRun: false,
    })),
  };
}

export function backspaceAmount(draft: PaymentDraft): PaymentDraft {
  if (draft.selected === null) return draft;
  const lines = withLine(draft, draft.selected, (line) => {
    const outcome = backspace(line.amount, "price");
    return {
      ...line,
      amount: outcome.kind === "edit" ? outcome.state : line.amount,
      tenderRun: false,
    };
  });
  return { ...draft, lines };
}

export function setReference(
  draft: PaymentDraft,
  method: PaymentMethod,
  reference: string,
): PaymentDraft {
  return { ...draft, lines: withLine(draft, method, (line) => ({ ...line, reference })) };
}

export function removeSelected(draft: PaymentDraft): PaymentDraft {
  const index = draft.lines.findIndex((line) => line.method === draft.selected);
  if (index === -1) return draft;
  const lines = draft.lines.filter((_, i) => i !== index);
  const selected = (lines[index] ?? lines[index - 1])?.method ?? null;
  return { ...draft, lines, selected };
}

export function moveSelected(draft: PaymentDraft, step: 1 | -1): PaymentDraft {
  if (draft.lines.length === 0) return draft;
  const index = draft.lines.findIndex((line) => line.method === draft.selected);
  const target =
    index === -1
      ? step === 1
        ? 0
        : draft.lines.length - 1
      : Math.min(Math.max(index + step, 0), draft.lines.length - 1);
  return { ...draft, selected: draft.lines[target]?.method ?? null };
}

export function validationIssue(bill: Bill, draft: PaymentDraft): ValidationIssue | null {
  const bad = draft.lines.find(
    (line) => line.amount.text.trim() !== "" && !parseRupees(line.amount.text).ok,
  );
  if (bad) return { kind: "bad-amount", method: bad.method };

  const summary = paymentSummary(bill, draft.lines);
  if (summary.remainingPaisa > 0) {
    return { kind: "underpaid", remainingPaisa: summary.remainingPaisa };
  }

  const { mode, unitPaisa } = bill.cashRounding;
  const cash = draft.lines.find((line) => line.method === "cash");
  if (mode !== "off" && cash && amountPaisa(cash) % unitPaisa !== 0) {
    return { kind: "cash-not-rounded" };
  }

  if (summary.totalPaisa > 0 && summary.paidPaisa > largePaymentFactor * summary.totalPaisa) {
    return { kind: "too-large", paidPaisa: summary.paidPaisa, totalPaisa: summary.totalPaisa };
  }
  return null;
}

export function toCompletePayload(
  draft: PaymentDraft,
  buyer: BuyerInput | undefined,
): CompleteSaleInput {
  const payments = draft.lines.flatMap((line) => {
    const amount = amountPaisa(line);
    if (amount <= 0) return [];
    const reference = line.method === "cash" ? "" : line.reference.trim();
    return [
      {
        method: line.method,
        amountPaisa: amount,
        ...(reference === "" ? {} : { reference }),
      },
    ];
  });
  return { draftId: draft.draftId, payments, ...(buyer ? { buyer } : {}) };
}
