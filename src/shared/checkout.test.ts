import { describe, expect, it } from "vitest";
import {
  completeSaleInputSchema,
  discountSchema,
  holdInputSchema,
  paymentMethodLabels,
  paymentMethods,
  scanInputSchema,
  updateLineInputSchema,
} from "./checkout";

const id = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("checkout schemas", () => {
  it("labels every payment method", () => {
    expect(paymentMethods.map((m) => paymentMethodLabels[m])).toEqual([
      "Cash",
      "Card",
      "Bank transfer",
      "JazzCash",
      "Easypaisa",
    ]);
  });

  it("limits discounts", () => {
    expect(discountSchema.safeParse({ kind: "percent", bps: 10001 }).success).toBe(false);
    expect(discountSchema.safeParse({ kind: "amount", amountPaisa: -1 }).success).toBe(false);
    expect(discountSchema.safeParse({ kind: "percent", bps: 1000 }).success).toBe(true);
  });

  it("takes no label on hold", () => {
    expect(holdInputSchema.safeParse({ draftId: id }).success).toBe(true);
    expect(holdInputSchema.safeParse({ draftId: id, label: "Mr Khan" }).success).toBe(false);
  });

  it("trims and bounds a scanned barcode and refuses extra keys", () => {
    expect(scanInputSchema.parse({ barcode: " 123 " }).barcode).toBe("123");
    expect(scanInputSchema.safeParse({ barcode: "" }).success).toBe(false);
    expect(scanInputSchema.safeParse({ barcode: "1", extra: 1 }).success).toBe(false);
  });

  it("needs at least one field to update a line", () => {
    expect(updateLineInputSchema.safeParse({ lineId: id }).success).toBe(false);
    expect(updateLineInputSchema.safeParse({ lineId: id, discount: null }).success).toBe(true);
    expect(updateLineInputSchema.safeParse({ lineId: id, qtyMilli: 0 }).success).toBe(false);
  });

  it("refuses a reference on cash and non-integer amounts", () => {
    const base = { draftId: id };
    expect(
      completeSaleInputSchema.safeParse({
        ...base,
        payments: [{ method: "cash", amountPaisa: 100, reference: "x" }],
      }).success,
    ).toBe(false);
    expect(
      completeSaleInputSchema.safeParse({
        ...base,
        payments: [{ method: "card", amountPaisa: 100, reference: "4821" }],
      }).success,
    ).toBe(true);
    expect(
      completeSaleInputSchema.safeParse({
        ...base,
        payments: [{ method: "cash", amountPaisa: 10.5 }],
      }).success,
    ).toBe(false);
  });
});
