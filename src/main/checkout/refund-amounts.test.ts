import { describe, expect, it } from "vitest";
import { refundLineAmounts, type LineParts, type RefundLineAmounts } from "./refund-amounts";

const original: LineParts = {
  qtyMilli: 3000,
  grossPaisa: 1000,
  lineDiscountPaisa: 100,
  billDiscountPaisa: 7,
  taxPaisa: 137,
};

const none: LineParts = {
  qtyMilli: 0,
  grossPaisa: 0,
  lineDiscountPaisa: 0,
  billDiscountPaisa: 0,
  taxPaisa: 0,
};

const accumulate = (
  refunded: LineParts,
  amounts: RefundLineAmounts,
  qtyMilli: number,
): LineParts => ({
  qtyMilli: refunded.qtyMilli + qtyMilli,
  grossPaisa: refunded.grossPaisa - amounts.grossPaisa,
  lineDiscountPaisa: refunded.lineDiscountPaisa - amounts.lineDiscountPaisa,
  billDiscountPaisa: refunded.billDiscountPaisa - amounts.billDiscountPaisa,
  taxPaisa: refunded.taxPaisa - amounts.taxPaisa,
});

describe("refundLineAmounts", () => {
  it.each([true, false])(
    "three returns of one add up to the original (prices include tax: %s)",
    (pricesIncludeTax) => {
      let refunded = none;
      let total = 0;
      for (let i = 0; i < 3; i += 1) {
        const amounts = refundLineAmounts({ original, pricesIncludeTax, refunded, qtyMilli: 1000 });
        total -= amounts.totalPaisa;
        refunded = accumulate(refunded, amounts, 1000);
      }
      expect(refunded).toEqual({
        qtyMilli: 3000,
        grossPaisa: 1000,
        lineDiscountPaisa: 100,
        billDiscountPaisa: 7,
        taxPaisa: 137,
      });
      expect(total).toBe(1000 - 107 + (pricesIncludeTax ? 0 : 137));
    },
  );

  it("splits a weighed line into 0.400 and 0.850 exactly", () => {
    const weighed: LineParts = {
      qtyMilli: 1250,
      grossPaisa: 3333,
      lineDiscountPaisa: 0,
      billDiscountPaisa: 13,
      taxPaisa: 481,
    };
    const first = refundLineAmounts({
      original: weighed,
      pricesIncludeTax: true,
      refunded: none,
      qtyMilli: 400,
    });
    const second = refundLineAmounts({
      original: weighed,
      pricesIncludeTax: true,
      refunded: accumulate(none, first, 400),
      qtyMilli: 850,
    });
    expect(first.grossPaisa + second.grossPaisa).toBe(-3333);
    expect(first.billDiscountPaisa + second.billDiscountPaisa).toBe(-13);
    expect(first.taxPaisa + second.taxPaisa).toBe(-481);
  });

  it("never returns a positive amount", () => {
    const tiny: LineParts = { ...original, billDiscountPaisa: 1 };
    const amounts = refundLineAmounts({
      original: tiny,
      pricesIncludeTax: true,
      refunded: { ...none, qtyMilli: 1000, billDiscountPaisa: 1 },
      qtyMilli: 1000,
    });
    expect(amounts.billDiscountPaisa).toBe(0);
    expect(amounts.totalPaisa).toBeLessThan(0);
  });

  it("refuses a bad quantity", () => {
    const base = { original, pricesIncludeTax: true, refunded: none };
    expect(() => refundLineAmounts({ ...base, qtyMilli: 0 })).toThrow();
    expect(() => refundLineAmounts({ ...base, qtyMilli: 3001 })).toThrow();
    expect(() =>
      refundLineAmounts({ ...base, refunded: { ...none, qtyMilli: 2000 }, qtyMilli: 1001 }),
    ).toThrow();
  });
});
