import { describe, expect, it } from "vitest";
import { maxPaisa } from "./checkout";
import {
  createPurchaseOrderInputSchema,
  derivePurchaseOrderStatus,
  purchaseOrderLineTotalPaisa,
  purchaseOrderTotalPaisa,
  remainingQtyMilli,
  storedPurchaseOrderStatuses,
  updatePurchaseOrderInputSchema,
} from "./purchase-orders";

const uuid = "01900000-0000-7000-8000-000000000001";
const line = { productId: uuid, orderedQtyMilli: 1000, unitCostPaisa: 100 };
const order = { supplierId: uuid, notes: null, lines: [line] };
const parse = (value: unknown) => createPurchaseOrderInputSchema.safeParse(value).success;

describe("purchase order totals", () => {
  it.each([
    [1005, 100, 101],
    [2500, 1, 3],
    [1500, 33, 50],
    [1250, 14333, 17916],
    [1000, 0, 0],
  ])("rounds %i milli at %i paisa to %i", (qty, cost, total) => {
    expect(purchaseOrderLineTotalPaisa(qty, cost)).toBe(total);
  });

  it("sums the rounded lines", () => {
    expect(purchaseOrderTotalPaisa([101, 3])).toBe(104);
  });
});

describe("derivePurchaseOrderStatus", () => {
  const none = [{ orderedQtyMilli: 1000, receivedQtyMilli: 0 }];
  const some = [
    { orderedQtyMilli: 1000, receivedQtyMilli: 400 },
    { orderedQtyMilli: 1000, receivedQtyMilli: 0 },
  ];
  const all = [
    { orderedQtyMilli: 1000, receivedQtyMilli: 1000 },
    { orderedQtyMilli: 1000, receivedQtyMilli: 1500 },
  ];

  it.each(storedPurchaseOrderStatuses)("derives from %s", (stored) => {
    const expected = {
      draft: ["draft", "draft", "draft"],
      confirmed: ["confirmed", "partly_received", "received"],
      cancelled: ["cancelled", "cancelled", "cancelled"],
    }[stored];
    expect([none, some, all].map((l) => derivePurchaseOrderStatus(stored, l))).toEqual(expected);
  });
});

describe("remainingQtyMilli", () => {
  it("reads the open quantity", () => {
    expect(remainingQtyMilli("confirmed", { orderedQtyMilli: 1000, receivedQtyMilli: 400 })).toBe(
      600,
    );
  });

  it("never goes below zero", () => {
    expect(remainingQtyMilli("received", { orderedQtyMilli: 1000, receivedQtyMilli: 1500 })).toBe(
      0,
    );
  });

  it("is zero on a cancelled order", () => {
    expect(remainingQtyMilli("cancelled", { orderedQtyMilli: 1000, receivedQtyMilli: 400 })).toBe(
      0,
    );
  });
});

describe("purchase order schemas", () => {
  it("accepts a valid order and update", () => {
    expect(parse(order)).toBe(true);
    expect(updatePurchaseOrderInputSchema.safeParse({ id: uuid, ...order }).success).toBe(true);
  });

  it.each([
    ["zero quantity", { ...line, orderedQtyMilli: 0 }],
    ["negative cost", { ...line, unitCostPaisa: -1 }],
    ["fractional cost", { ...line, unitCostPaisa: 1.5 }],
    ["extra key", { ...line, extra: 1 }],
    [
      "line total above the limit",
      { ...line, orderedQtyMilli: 1_000_000_000, unitCostPaisa: maxPaisa },
    ],
  ])("rejects %s", (_, bad) => {
    expect(parse({ ...order, lines: [bad] })).toBe(false);
  });

  it("rejects no lines and more than 1000", () => {
    expect(parse({ ...order, lines: [] })).toBe(false);
    expect(parse({ ...order, lines: Array.from({ length: 1001 }, () => line) })).toBe(false);
  });

  it("rejects an extra key on the order", () => {
    expect(parse({ ...order, extra: 1 })).toBe(false);
  });
});
