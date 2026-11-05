import { assertInteger, divRoundHalfUp } from "../../shared/rounding";

export type LineParts = {
  qtyMilli: number;
  grossPaisa: number;
  lineDiscountPaisa: number;
  billDiscountPaisa: number;
  taxPaisa: number;
};

export type RefundLineAmounts = {
  grossPaisa: number;
  lineDiscountPaisa: number;
  billDiscountPaisa: number;
  taxPaisa: number;
  totalPaisa: number;
};

const negate = (value: number): number => (value === 0 ? 0 : -value);

export function refundLineAmounts(input: {
  original: LineParts;
  pricesIncludeTax: boolean;
  refunded: LineParts;
  qtyMilli: number;
}): RefundLineAmounts {
  const { original, refunded, qtyMilli } = input;
  assertInteger(qtyMilli, "qtyMilli");
  if (qtyMilli <= 0) throw new Error("Return quantity must be positive");
  if (original.qtyMilli <= 0) throw new Error("Original quantity must be positive");
  if (refunded.qtyMilli + qtyMilli > original.qtyMilli) {
    throw new Error("Return quantity is more than was sold");
  }

  const returnedMilli = BigInt(refunded.qtyMilli + qtyMilli);
  const soldMilli = BigInt(original.qtyMilli);
  const part = (originalPaisa: number, refundedPaisa: number): number =>
    Math.max(0, divRoundHalfUp(BigInt(originalPaisa) * returnedMilli, soldMilli) - refundedPaisa);

  const gross = part(original.grossPaisa, refunded.grossPaisa);
  const lineDiscount = part(original.lineDiscountPaisa, refunded.lineDiscountPaisa);
  const billDiscount = part(original.billDiscountPaisa, refunded.billDiscountPaisa);
  const tax = part(original.taxPaisa, refunded.taxPaisa);
  const total = gross - lineDiscount - billDiscount + (input.pricesIncludeTax ? 0 : tax);

  return {
    grossPaisa: negate(gross),
    lineDiscountPaisa: negate(lineDiscount),
    billDiscountPaisa: negate(billDiscount),
    taxPaisa: negate(tax),
    totalPaisa: negate(total),
  };
}
