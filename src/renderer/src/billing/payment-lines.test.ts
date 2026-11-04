import type { Bill } from "@shared/checkout";
import { describe, expect, it } from "vitest";
import {
  amountPaisa,
  backspaceAmount,
  moveSelected,
  newPaymentDraft,
  paymentSummary,
  quickTender,
  removeSelected,
  selectOrAdd,
  setAmountText,
  setReference,
  suggestedAmountPaisa,
  toCompletePayload,
  typeAmount,
  validationIssue,
  type PaymentDraft,
} from "./payment-lines";

function billOf(
  preTotalPaisa: number,
  cashRounding: Bill["cashRounding"] = { mode: "off", unitPaisa: 100 },
  roundingPaisa = 0,
): Bill {
  return {
    id: "d1",
    heldAt: null,
    billDiscount: null,
    lines: [],
    deletedLineCount: 0,
    totals: {
      subtotalPaisa: preTotalPaisa,
      discountPaisa: 0,
      taxPaisa: 0,
      roundingPaisa,
      totalPaisa: preTotalPaisa + roundingPaisa,
    },
    pricesIncludeTax: true,
    cashRounding,
  };
}

const cashOnly = { mode: "cash-only", unitPaisa: 500 } as const;
const everyBill = { mode: "every-bill", unitPaisa: 500 } as const;

const typed = (draft: PaymentDraft, text: string): PaymentDraft =>
  [...text].reduce((acc, key) => typeAmount(acc, key), draft);

const retyped = (draft: PaymentDraft, text: string): PaymentDraft =>
  typed(
    {
      ...draft,
      lines: draft.lines.map((line) => ({ ...line, amount: { ...line.amount, fresh: true } })),
    },
    text,
  );

const amountOf = (draft: PaymentDraft, method: string): number =>
  amountPaisa(draft.lines.find((line) => line.method === method)!);

describe("default amounts", () => {
  it("suggests what is left with rounding off", () => {
    const bill = billOf(72000);
    let draft = selectOrAdd(newPaymentDraft("d1"), bill, "cash");
    expect(amountOf(draft, "cash")).toBe(72000);
    draft = typed(draft, "500");
    draft = selectOrAdd(draft, bill, "jazzcash");
    expect(amountOf(draft, "jazzcash")).toBe(22000);
    expect(draft.selected).toBe("jazzcash");
  });

  it("never suggests below zero", () => {
    const bill = billOf(10000);
    let draft = selectOrAdd(newPaymentDraft("d1"), bill, "cash");
    draft = typed(draft, "5000");
    draft = selectOrAdd(draft, bill, "card");
    expect(amountOf(draft, "card")).toBe(0);
  });

  it("rounds the cash share to the unit under cash-only rounding", () => {
    const bill = billOf(72200, cashOnly);
    expect(suggestedAmountPaisa(bill, [], "cash")).toBe(72000);
    let draft = selectOrAdd(newPaymentDraft("d1"), bill, "card");
    draft = typed(draft, "100");
    expect(suggestedAmountPaisa(bill, draft.lines, "cash")).toBe(62000);
  });

  it("rounds the cash due up under every-bill rounding", () => {
    const bill = billOf(72200, everyBill, -200);
    expect(suggestedAmountPaisa(bill, [], "cash")).toBe(72000);
    const up = billOf(72300, everyBill, 200);
    expect(suggestedAmountPaisa(up, [], "cash")).toBe(72500);
    const card = [
      { method: "card", amount: { text: "123", fresh: false }, reference: "", tenderRun: false },
    ] as const;
    expect(suggestedAmountPaisa(up, card, "cash")).toBe(60500);
  });
});

describe("lines and selection", () => {
  it("keeps one line per method and selects the existing one", () => {
    const bill = billOf(72000);
    let draft = selectOrAdd(newPaymentDraft("d1"), bill, "cash");
    draft = selectOrAdd(draft, bill, "card");
    draft = selectOrAdd(draft, bill, "cash");
    expect(draft.lines.map((line) => line.method)).toEqual(["cash", "card"]);
    expect(draft.selected).toBe("cash");
  });

  it("replaces the first typed digit and edits with backspace", () => {
    const bill = billOf(72000);
    let draft = selectOrAdd(newPaymentDraft("d1"), bill, "cash");
    draft = typed(draft, "12.5");
    expect(amountOf(draft, "cash")).toBe(1250);
    draft = backspaceAmount(draft);
    expect(draft.lines[0]?.amount.text).toBe("12.");
  });

  it("takes typed text, refuses bad text and ends the tender run", () => {
    const bill = billOf(72000);
    let draft = quickTender(newPaymentDraft("d1"), bill, 500000);
    draft = setAmountText(draft, "cash", "250.5");
    expect(amountOf(draft, "cash")).toBe(25050);
    expect(setAmountText(draft, "cash", "2.505")).toBe(draft);
    expect(setAmountText(draft, "cash", "abc")).toBe(draft);
    draft = quickTender(draft, bill, 50000);
    expect(amountOf(draft, "cash")).toBe(50000);
  });

  it("removes the selected line and selects the next, else the previous", () => {
    const bill = billOf(72000);
    let draft = newPaymentDraft("d1");
    for (const method of ["cash", "card", "jazzcash"] as const) {
      draft = selectOrAdd(draft, bill, method);
    }
    draft = { ...draft, selected: "card" };
    draft = removeSelected(draft);
    expect(draft.selected).toBe("jazzcash");
    draft = removeSelected(draft);
    expect(draft.selected).toBe("cash");
    draft = removeSelected(draft);
    expect(draft.lines).toEqual([]);
    expect(draft.selected).toBeNull();
  });

  it("moves the selection and clamps at both ends", () => {
    const bill = billOf(72000);
    let draft = newPaymentDraft("d1");
    draft = selectOrAdd(selectOrAdd(draft, bill, "cash"), bill, "card");
    expect(moveSelected(draft, 1).selected).toBe("card");
    draft = moveSelected(draft, -1);
    expect(draft.selected).toBe("cash");
    expect(moveSelected(draft, -1).selected).toBe("cash");
  });
});

describe("quick tender", () => {
  const bill = billOf(72000);

  it("creates the cash line and replaces on the first note, then adds", () => {
    let draft = quickTender(newPaymentDraft("d1"), bill, 500000);
    expect(amountOf(draft, "cash")).toBe(500000);
    expect(draft.selected).toBe("cash");
    draft = quickTender(draft, bill, 50000);
    expect(amountOf(draft, "cash")).toBe(550000);
    draft = quickTender(draft, bill, 100000);
    expect(amountOf(draft, "cash")).toBe(650000);
  });

  it("sets exact to the cash due and ends the run", () => {
    let draft = quickTender(newPaymentDraft("d1"), bill, 500000);
    draft = quickTender(draft, bill, "exact");
    expect(amountOf(draft, "cash")).toBe(72000);
    draft = quickTender(draft, bill, 100000);
    expect(amountOf(draft, "cash")).toBe(100000);
  });

  it("ends the run when an amount is typed or a line is added", () => {
    let draft = quickTender(newPaymentDraft("d1"), bill, 500000);
    draft = typed(draft, "100");
    draft = quickTender(draft, bill, 50000);
    expect(amountOf(draft, "cash")).toBe(50000);
    draft = selectOrAdd(draft, bill, "card");
    draft = quickTender(draft, bill, 100000);
    expect(amountOf(draft, "cash")).toBe(100000);
  });

  it("exact ignores the cash line itself and uses the other lines", () => {
    let draft = selectOrAdd(newPaymentDraft("d1"), bill, "card");
    draft = typed(draft, "200");
    draft = quickTender(draft, bill, "exact");
    expect(amountOf(draft, "cash")).toBe(52000);
  });
});

describe("summary", () => {
  it("shows the change from a card overpay", () => {
    const bill = billOf(72000);
    let draft = selectOrAdd(newPaymentDraft("d1"), bill, "card");
    draft = typed(draft, "1000");
    expect(paymentSummary(bill, draft.lines)).toMatchObject({
      paidPaisa: 100000,
      remainingPaisa: 0,
      changePaisa: 28000,
    });
  });

  it("updates the rounding live under cash-only rounding", () => {
    const bill = billOf(72200, cashOnly);
    expect(paymentSummary(bill, []).roundingPaisa).toBe(0);
    let draft = selectOrAdd(newPaymentDraft("d1"), bill, "cash");
    expect(paymentSummary(bill, draft.lines)).toMatchObject({
      roundingPaisa: -200,
      totalPaisa: 72000,
      remainingPaisa: 0,
    });
    draft = selectOrAdd(draft, bill, "card");
    draft = typed(draft, "100");
    expect(paymentSummary(bill, draft.lines).roundingPaisa).toBe(-200);
  });

  it("treats a zero-total bill as fully paid", () => {
    expect(paymentSummary(billOf(0), [])).toMatchObject({ totalPaisa: 0, remainingPaisa: 0 });
    expect(validationIssue(billOf(0), newPaymentDraft("d1"))).toBeNull();
  });
});

describe("validationIssue", () => {
  it("reports underpaid with what is left", () => {
    const bill = billOf(72000);
    const draft = typed(selectOrAdd(newPaymentDraft("d1"), bill, "cash"), "500");
    expect(validationIssue(bill, draft)).toEqual({ kind: "underpaid", remainingPaisa: 22000 });
  });

  it("reports an amount that won't parse", () => {
    const bill = billOf(72000);
    const draft = typed(selectOrAdd(newPaymentDraft("d1"), bill, "cash"), "5.");
    expect(validationIssue(bill, draft)).toEqual({ kind: "bad-amount", method: "cash" });
  });

  it("reports a cash amount that is not a multiple of the unit", () => {
    const bill = billOf(72200, cashOnly);
    const draft = typed(selectOrAdd(newPaymentDraft("d1"), bill, "cash"), "722");
    expect(validationIssue(bill, draft)).toEqual({ kind: "cash-not-rounded" });
    expect(validationIssue(bill, retyped(draft, "720"))).toBeNull();
  });

  it("confirms only above 1000 times the total", () => {
    const bill = billOf(10000);
    const exact = typed(selectOrAdd(newPaymentDraft("d1"), bill, "cash"), "100000");
    expect(validationIssue(bill, exact)).toBeNull();
    const above = retyped(exact, "100001");
    expect(validationIssue(bill, above)).toEqual({
      kind: "too-large",
      paidPaisa: 10000100,
      totalPaisa: 10000,
    });
  });
});

describe("toCompletePayload", () => {
  it("drops Rs 0 lines, empty references and cash references", () => {
    const bill = billOf(72000);
    let draft = typed(selectOrAdd(newPaymentDraft("d1"), bill, "cash"), "500");
    draft = selectOrAdd(draft, bill, "jazzcash");
    draft = setReference(draft, "jazzcash", "  0300123 ");
    draft = selectOrAdd(draft, bill, "card");
    draft = typed(draft, "0");
    draft = setReference(draft, "cash", "ignored");
    expect(toCompletePayload(draft, undefined)).toEqual({
      draftId: "d1",
      payments: [
        { method: "cash", amountPaisa: 50000 },
        { method: "jazzcash", amountPaisa: 22000, reference: "0300123" },
      ],
    });
  });

  it("includes the buyer only when given", () => {
    const bill = billOf(0);
    const draft = newPaymentDraft("d1");
    expect(toCompletePayload(draft, undefined)).toEqual({ draftId: "d1", payments: [] });
    expect(toCompletePayload(draft, { name: "Mr Khan" }).buyer).toEqual({ name: "Mr Khan" });
    expect(bill.totals.totalPaisa).toBe(0);
  });
});
