import { describe, expect, it } from "vitest";
import { postPurchaseReturnInputSchema } from "./purchase-returns";

const uuid = "01900000-0000-7000-8000-000000000001";
const other = "01900000-0000-7000-8000-000000000002";
const supplier = {
  kind: "supplier",
  supplierId: uuid,
  reason: "damaged",
  notes: null,
  lines: [{ productId: uuid, qtyMilli: 1000 }],
};
const note = {
  kind: "note",
  goodsReceivedNoteId: uuid,
  reason: "expired",
  notes: null,
  lines: [{ goodsReceivedLineId: uuid, qtyMilli: 1000 }],
};
const parse = (value: unknown) => postPurchaseReturnInputSchema.safeParse(value);

describe("postPurchaseReturnInputSchema", () => {
  it("accepts both kinds", () => {
    expect(parse(supplier).success).toBe(true);
    expect(parse(note).success).toBe(true);
  });

  it("refuses an unknown reason and a missing reason", () => {
    expect(parse({ ...supplier, reason: "lost" }).success).toBe(false);
    const { reason: _reason, ...rest } = supplier;
    expect(parse(rest).success).toBe(false);
  });

  it("refuses extra keys, including a cost on a line", () => {
    expect(parse({ ...supplier, extra: 1 }).success).toBe(false);
    expect(
      parse({ ...supplier, lines: [{ productId: uuid, qtyMilli: 1000, unitCostPaisa: 1 }] })
        .success,
    ).toBe(false);
    expect(parse({ ...note, supplierId: uuid }).success).toBe(false);
  });

  it("refuses no lines and a repeated line", () => {
    expect(parse({ ...supplier, lines: [] }).success).toBe(false);
    expect(
      parse({
        ...supplier,
        lines: [
          { productId: uuid, qtyMilli: 1000 },
          { productId: uuid, qtyMilli: 2000 },
        ],
      }).success,
    ).toBe(false);
    expect(
      parse({
        ...note,
        lines: [
          { goodsReceivedLineId: uuid, qtyMilli: 1000 },
          { goodsReceivedLineId: uuid, qtyMilli: 2000 },
        ],
      }).success,
    ).toBe(false);
    expect(
      parse({
        ...supplier,
        lines: [
          { productId: uuid, qtyMilli: 1000 },
          { productId: other, qtyMilli: 2000 },
        ],
      }).success,
    ).toBe(true);
  });

  it("refuses a zero or fractional quantity", () => {
    expect(parse({ ...supplier, lines: [{ productId: uuid, qtyMilli: 0 }] }).success).toBe(false);
    expect(parse({ ...supplier, lines: [{ productId: uuid, qtyMilli: 1.5 }] }).success).toBe(false);
  });

  it("trims notes to null when blank and refuses 501 characters", () => {
    const parsed = postPurchaseReturnInputSchema.parse({ ...supplier, notes: "   " });
    expect(parsed.notes).toBeNull();
    expect(parse({ ...supplier, notes: "x".repeat(500) }).success).toBe(true);
    expect(parse({ ...supplier, notes: "x".repeat(501) }).success).toBe(false);
  });
});
