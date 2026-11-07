import { describe, expect, it } from "vitest";
import { maxPaisa } from "./checkout";
import { postGoodsReceivedInputSchema } from "./goods-received";

const uuid = "01900000-0000-7000-8000-000000000001";
const directLine = { productId: uuid, qtyMilli: 1000, unitCostPaisa: 100 };
const orderLine = { purchaseOrderLineId: uuid, qtyMilli: 1000, unitCostPaisa: 100 };
const direct = {
  kind: "direct",
  supplierId: uuid,
  supplierInvoiceNo: "INV-1",
  lines: [directLine],
};
const order = {
  kind: "order",
  purchaseOrderId: uuid,
  supplierInvoiceNo: "INV-1",
  lines: [orderLine],
};
const parse = (value: unknown) => postGoodsReceivedInputSchema.safeParse(value);

describe("postGoodsReceivedInputSchema", () => {
  it("accepts both kinds", () => {
    expect(parse(direct).success).toBe(true);
    expect(parse(order).success).toBe(true);
  });

  it("rejects an unknown kind", () => {
    expect(parse({ ...direct, kind: "other" }).success).toBe(false);
  });

  it("rejects mixed fields", () => {
    expect(parse({ ...order, lines: [{ ...orderLine, productId: uuid }] }).success).toBe(false);
    expect(
      parse({ ...direct, lines: [{ ...directLine, purchaseOrderLineId: uuid }] }).success,
    ).toBe(false);
    expect(parse({ ...order, supplierId: uuid }).success).toBe(false);
  });

  it("rejects extra keys", () => {
    expect(parse({ ...direct, extra: 1 }).success).toBe(false);
    expect(parse({ ...direct, lines: [{ ...directLine, extra: 1 }] }).success).toBe(false);
  });

  it("rejects empty and oversized line lists", () => {
    expect(parse({ ...direct, lines: [] }).success).toBe(false);
    expect(
      parse({ ...direct, lines: Array.from({ length: 1001 }, () => directLine) }).success,
    ).toBe(false);
    expect(
      parse({ ...direct, lines: Array.from({ length: 1000 }, () => directLine) }).success,
    ).toBe(true);
  });

  it("rejects zero quantity and negative cost", () => {
    expect(parse({ ...direct, lines: [{ ...directLine, qtyMilli: 0 }] }).success).toBe(false);
    expect(parse({ ...direct, lines: [{ ...directLine, unitCostPaisa: -1 }] }).success).toBe(false);
  });

  it("accepts zero cost", () => {
    expect(parse({ ...direct, lines: [{ ...directLine, unitCostPaisa: 0 }] }).success).toBe(true);
  });

  it("trims the invoice number and rejects blank or over 64 characters", () => {
    const parsed = parse({ ...direct, supplierInvoiceNo: "  INV-9  " });
    expect(parsed.success && parsed.data.supplierInvoiceNo).toBe("INV-9");
    expect(parse({ ...direct, supplierInvoiceNo: "   " }).success).toBe(false);
    expect(parse({ ...direct, supplierInvoiceNo: "a".repeat(64) }).success).toBe(true);
    expect(parse({ ...direct, supplierInvoiceNo: "a".repeat(65) }).success).toBe(false);
  });

  it("rejects a line total above the limit", () => {
    const big = { ...directLine, qtyMilli: 2000, unitCostPaisa: maxPaisa };
    expect(parse({ ...direct, lines: [big] }).success).toBe(false);
    expect(parse({ ...order, lines: [{ ...orderLine, ...big }] }).success).toBe(false);
  });
});
