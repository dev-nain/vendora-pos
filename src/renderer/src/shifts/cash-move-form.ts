import { paisaAmountSchema, type AddCashMoveInput } from "@shared/shifts";
import { parseRupees } from "@renderer/lib/money";

export const REASON_MAX = 120;

export interface CashMoveErrors {
  amount?: string;
  reason?: string;
}

export function parseCashMoveForm(
  kind: AddCashMoveInput["kind"],
  amountText: string,
  reasonText: string,
): { ok: true; input: AddCashMoveInput } | { ok: false; errors: CashMoveErrors } {
  const errors: CashMoveErrors = {};

  const amount = parseRupees(amountText);
  const paisa = amount.ok ? paisaAmountSchema.safeParse(amount.paisa) : null;
  if (!paisa?.success) {
    errors.amount =
      amount.ok && amount.paisa === 0
        ? "Enter an amount above 0"
        : "Enter an amount like 500 or 500.50";
  }

  const reason = reasonText.trim();
  if (reason === "") errors.reason = "Enter a reason";
  else if (reason.length > REASON_MAX) {
    errors.reason = `Reason must be ${REASON_MAX} characters or fewer`;
  }

  if (errors.amount || errors.reason || !paisa?.success) return { ok: false, errors };
  return { ok: true, input: { kind, amountPaisa: paisa.data, reason } };
}
