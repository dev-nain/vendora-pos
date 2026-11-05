import type { Discount } from "@shared/checkout";
import { parseTaxRatePercent, rateInputText } from "../categories/tax-rate-input";
import { parseRupees, rupeeInputText } from "../lib/money";

export type DiscountKind = Discount["kind"];

export type DiscountParse =
  | { ok: true; discount: Discount | null }
  | { ok: false; message: string };

export const toggleDiscountKind = (kind: DiscountKind): DiscountKind =>
  kind === "percent" ? "amount" : "percent";

export function parseDiscountInput(text: string, kind: DiscountKind): DiscountParse {
  if (text.trim() === "") return { ok: true, discount: null };
  if (kind === "percent") {
    const parsed = parseTaxRatePercent(text);
    if (!parsed.ok) return { ok: false, message: "Enter a percentage from 0 to 100." };
    return { ok: true, discount: parsed.rateBps === 0 ? null : { kind, bps: parsed.rateBps } };
  }
  const parsed = parseRupees(text);
  if (!parsed.ok) return { ok: false, message: "Enter an amount in rupees." };
  return { ok: true, discount: parsed.paisa === 0 ? null : { kind, amountPaisa: parsed.paisa } };
}

export function discountInputText(discount: Discount | null): string {
  if (!discount) return "";
  return discount.kind === "percent"
    ? rateInputText(discount.bps)
    : rupeeInputText(discount.amountPaisa);
}
