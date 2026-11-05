import {
  paymentMethods,
  type Bill,
  type BuyerInput,
  type CompleteSaleInput,
  type PaymentMethod,
} from "@shared/checkout";
import { refundCapPaisa } from "@shared/returns";
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
  refundMode: boolean;
  preTotalPaisa: number;
  roundingPaisa: number;
  totalPaisa: number;
  paidPaisa: number;
  remainingPaisa: number;
  overPaisa: number;
  changePaisa: number;
};

export type ValidationIssue =
  | { kind: "underpaid"; remainingPaisa: number }
  | { kind: "under-refunded"; remainingPaisa: number }
  | { kind: "over-refunded"; overPaisa: number; duePaisa: number }
  | { kind: "over-cap"; method: PaymentMethod; capPaisa: number }
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

export const refundMode = (bill: Bill): boolean =>
  bill.totals.totalPaisa - bill.totals.roundingPaisa < 0;

export function paymentSummary(bill: Bill, lines: readonly PaymentLine[]): PaymentSummary {
  const preTotalPaisa = bill.totals.totalPaisa - bill.totals.roundingPaisa;
  const tenders = tendersOf(lines);
  const refund = refundMode(bill);
  const roundingPaisa = tenderRoundingPaisa(
    preTotalPaisa,
    bill.cashRounding,
    refund ? tenders.map((tender) => ({ ...tender, amountPaisa: -tender.amountPaisa })) : tenders,
  );
  const totalPaisa = preTotalPaisa + roundingPaisa;
  const paidPaisa = tenders.reduce((sum, tender) => sum + tender.amountPaisa, 0);
  if (refund) {
    const duePaisa = -totalPaisa;
    return {
      refundMode: true,
      preTotalPaisa,
      roundingPaisa,
      totalPaisa,
      paidPaisa,
      remainingPaisa: Math.max(0, duePaisa - paidPaisa),
      overPaisa: Math.max(0, paidPaisa - duePaisa),
      changePaisa: 0,
    };
  }
  return {
    refundMode: false,
    preTotalPaisa,
    roundingPaisa,
    totalPaisa,
    paidPaisa,
    remainingPaisa: Math.max(0, totalPaisa - paidPaisa),
    overPaisa: 0,
    changePaisa: Math.max(0, paidPaisa - totalPaisa),
  };
}

export function offeredMethods(bill: Bill): PaymentMethod[] {
  if (!refundMode(bill)) return [...paymentMethods];
  const offered = new Set<PaymentMethod>(["cash"]);
  for (const entry of bill.refund?.methods ?? []) {
    if (entry.availablePaisa > 0) offered.add(entry.method);
  }
  return paymentMethods.filter((method) => offered.has(method));
}

export function methodCapPaisa(
  bill: Bill,
  method: PaymentMethod,
  lines: readonly PaymentLine[],
): number {
  const refund = bill.refund;
  if (!refund || method === "cash") return 0;
  const index = lines.findIndex((line) => line.method === method);
  const earlier = index === -1 ? lines : lines.slice(0, index);
  const taken = tendersOf(earlier)
    .filter((tender) => tender.method !== "cash")
    .reduce((sum, tender) => sum + tender.amountPaisa, 0);
  return refundCapPaisa({
    availablePaisa: refund.methods.find((entry) => entry.method === method)?.availablePaisa ?? 0,
    linkedRefundPaisa: refund.linkedRefundPaisa - taken,
    netRefundPaisa: -paymentSummary(bill, lines).totalPaisa,
  });
}

const roundUpToUnit = (paisa: number, unitPaisa: number): number =>
  Math.floor((paisa + unitPaisa - 1) / unitPaisa) * unitPaisa;

export function suggestedAmountPaisa(
  bill: Bill,
  lines: readonly PaymentLine[],
  method: PaymentMethod,
): number {
  const others = lines.filter((line) => line.method !== method);
  if (refundMode(bill)) {
    const remaining = paymentSummary(bill, others).remainingPaisa;
    if (method !== "cash") {
      const cap = methodCapPaisa(bill, method, [
        ...others,
        { method, amount: freshField(""), reference: "", tenderRun: false },
      ]);
      return Math.min(cap, remaining);
    }
    const { mode, unitPaisa } = bill.cashRounding;
    return mode === "cash-only" ? roundToUnit(remaining, unitPaisa) : remaining;
  }
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
  if (refundMode(bill) && kind !== "exact") return draft;
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
  if (summary.refundMode) {
    for (const line of draft.lines) {
      if (line.method === "cash") continue;
      const capPaisa = methodCapPaisa(bill, line.method, draft.lines);
      if (amountPaisa(line) > capPaisa) return { kind: "over-cap", method: line.method, capPaisa };
    }
    const { mode, unitPaisa } = bill.cashRounding;
    const refundCash = draft.lines.find((line) => line.method === "cash");
    if (mode !== "off" && refundCash && amountPaisa(refundCash) % unitPaisa !== 0) {
      return { kind: "cash-not-rounded" };
    }
    if (summary.remainingPaisa > 0) {
      return { kind: "under-refunded", remainingPaisa: summary.remainingPaisa };
    }
    if (summary.overPaisa > 0) {
      return { kind: "over-refunded", overPaisa: summary.overPaisa, duePaisa: -summary.totalPaisa };
    }
  } else if (summary.remainingPaisa > 0) {
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
