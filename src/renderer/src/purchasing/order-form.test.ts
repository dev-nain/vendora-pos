import { describe, expect, it } from "vitest";

import type { LowStockItem } from "@shared/inventory";
import type { BarcodeLookup } from "@shared/products";
import {
  createPurchaseOrderInputSchema,
  type PurchaseOrder,
  type PurchaseOrderLine,
} from "@shared/purchase-orders";
import {
  addFromLookup,
  addProduct,
  buildOrderPayload,
  emptyOrderForm,
  formFromLowStock,
  formFromOrder,
  isOrderFormDirty,
  lineTotal,
  orderFormMessages,
  orderTotal,
  shortfallQtyText,
  type OrderFormValues,
  type OrderLineDraft,
  type OrderProduct,
} from "./order-form";

const supplierId = "01900000-0000-7000-8000-0000000000aa";
const tea: OrderProduct = {
  id: "01900000-0000-7000-8000-000000000001",
  nameEn: "Tapal Danedar",
  nameUr: "ٹپال",
  unit: "piece",
  costPaisa: 41000,
};
const sugar: OrderProduct = {
  id: "01900000-0000-7000-8000-000000000002",
  nameEn: "Sugar",
  nameUr: null,
  unit: "kg",
  costPaisa: 14333,
};

const draft = (overrides: Partial<OrderLineDraft> = {}): OrderLineDraft => ({
  key: "k1",
  productId: tea.id,
  nameEn: tea.nameEn,
  nameUr: tea.nameUr,
  unit: "piece",
  qtyText: "24",
  costText: "410",
  ...overrides,
});

const lowItem = (overrides: Partial<LowStockItem> = {}): LowStockItem => ({
  id: tea.id,
  nameEn: tea.nameEn,
  nameUr: tea.nameUr,
  categoryId: null,
  unit: "piece",
  costPaisa: 41000,
  onHandMilli: 0,
  thresholdMilli: 12000,
  shortfallMilli: 12000,
  ...overrides,
});

const valid = (lines: OrderLineDraft[]): OrderFormValues => ({
  supplierId,
  notes: "",
  lines,
});

describe("shortfallQtyText", () => {
  it("is the shortfall in the product unit", () => {
    expect(shortfallQtyText({ unit: "piece", shortfallMilli: 12000 })).toBe("12");
    expect(shortfallQtyText({ unit: "kg", shortfallMilli: 2500 })).toBe("2.5");
  });

  it("is empty when the shortfall is 0", () => {
    expect(shortfallQtyText({ unit: "piece", shortfallMilli: 0 })).toBe("");
    expect(shortfallQtyText({ unit: "kg", shortfallMilli: 0 })).toBe("");
  });

  it("rounds a fractional piece shortfall up", () => {
    expect(shortfallQtyText({ unit: "piece", shortfallMilli: 2500 })).toBe("3");
    expect(shortfallQtyText({ unit: "piece", shortfallMilli: 1 })).toBe("1");
  });

  it("covers the full shortfall when on hand is negative", () => {
    const item = lowItem({ onHandMilli: -3000, thresholdMilli: 5000, shortfallMilli: 8000 });
    expect(shortfallQtyText(item)).toBe("8");
  });
});

describe("formFromLowStock", () => {
  it("defaults quantity to the shortfall and cost to the stored cost, with no supplier", () => {
    const form = formFromLowStock([
      lowItem(),
      lowItem({
        id: sugar.id,
        nameEn: "Sugar",
        nameUr: null,
        unit: "kg",
        costPaisa: 14333,
        thresholdMilli: 2500,
        shortfallMilli: 2500,
      }),
      lowItem({ id: "01900000-0000-7000-8000-000000000003", shortfallMilli: 0 }),
    ]);
    expect(form.supplierId).toBeNull();
    expect(form.notes).toBe("");
    expect(form.lines.map((line) => [line.productId, line.qtyText, line.costText])).toEqual([
      [tea.id, "12", "410"],
      [sugar.id, "2.5", "143.33"],
      ["01900000-0000-7000-8000-000000000003", "", "410"],
    ]);
    expect(new Set(form.lines.map((line) => line.key)).size).toBe(3);
  });
});

describe("addProduct", () => {
  it("adds a new line at the stored cost", () => {
    const { lines, key } = addProduct([], tea, 1000);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ productId: tea.id, qtyText: "1", costText: "410", key });
  });

  it("adds an empty quantity for 0", () => {
    expect(addProduct([], sugar, 0).lines[0]?.qtyText).toBe("");
  });

  it("adds to an existing line and keeps an edited cost", () => {
    const existing = draft({ qtyText: "24", costText: "400" });
    const { lines, key } = addProduct([existing], tea, 24000);
    expect(lines).toEqual([{ ...existing, qtyText: "48" }]);
    expect(key).toBe(existing.key);
  });

  it("treats an empty or invalid quantity as 0", () => {
    expect(addProduct([draft({ qtyText: "" })], tea, 1000).lines[0]?.qtyText).toBe("1");
    expect(addProduct([draft({ qtyText: "abc" })], tea, 1000).lines[0]?.qtyText).toBe("1");
  });

  it("adds to the first of two duplicate lines", () => {
    const first = draft({ key: "a", qtyText: "1" });
    const second = draft({ key: "b", qtyText: "5" });
    const { lines, key } = addProduct([first, second], tea, 1000);
    expect(key).toBe("a");
    expect(lines.map((line) => line.qtyText)).toEqual(["2", "5"]);
  });

  it("leaves the quantity alone for 0 on an existing line", () => {
    const existing = draft({ qtyText: "" });
    expect(addProduct([existing], tea, 0)).toEqual({ lines: [existing], key: existing.key });
  });
});

describe("addFromLookup", () => {
  const product = {
    id: tea.id,
    nameEn: tea.nameEn,
    nameUr: tea.nameUr,
    unit: tea.unit,
    salePricePaisa: 45000,
    taxCategoryId: "t",
    costPaisa: 1708,
  };
  const barcode = (packQtyMilli: number): BarcodeLookup => ({
    source: "barcode",
    product,
    packQtyMilli,
    packPricePaisa: null,
  });
  const scale: BarcodeLookup = {
    source: "scale",
    product,
    scale: { itemCode: "100", kind: "weight", qtyMilli: 750 },
  };

  it("adds one unit for a plain barcode and keeps focus", () => {
    const result = addFromLookup([], barcode(1000));
    expect(result.lines[0]).toMatchObject({ qtyText: "1", costText: "17.08" });
    expect(result.focus).toBe("none");
  });

  it("adds the pack quantity at the per-piece cost on a new line", () => {
    const result = addFromLookup([], barcode(24000));
    expect(result.lines[0]).toMatchObject({ qtyText: "24", costText: "17.08" });
  });

  it("adds a pack onto an existing line and keeps its cost", () => {
    const existing = draft({ qtyText: "24", costText: "16" });
    const result = addFromLookup([existing], barcode(24000));
    expect(result.lines).toEqual([{ ...existing, qtyText: "48" }]);
  });

  it("adds an empty line for a scale label and focuses the quantity", () => {
    const result = addFromLookup([], scale);
    expect(result.lines[0]?.qtyText).toBe("");
    expect(result.focus).toBe("qty");
  });

  it("leaves the quantity alone for a repeated scale label", () => {
    const existing = draft({ qtyText: "3" });
    const result = addFromLookup([existing], scale);
    expect(result.lines).toEqual([existing]);
    expect(result.key).toBe(existing.key);
    expect(result.focus).toBe("qty");
  });
});

describe("lineTotal and orderTotal", () => {
  it("rounds half up", () => {
    expect(lineTotal(draft({ unit: "kg", qtyText: "1.005", costText: "1" }))).toBe(101);
    expect(lineTotal(draft({ unit: "kg", qtyText: "2.5", costText: "0.01" }))).toBe(3);
  });

  it("is null for an invalid line", () => {
    expect(lineTotal(draft({ qtyText: "" }))).toBeNull();
    expect(lineTotal(draft({ qtyText: "0" }))).toBeNull();
    expect(lineTotal(draft({ costText: "x" }))).toBeNull();
  });

  it("is null instead of throwing for an oversize line", () => {
    const huge = draft({ unit: "kg", qtyText: "1000000", costText: "9999999999999" });
    expect(lineTotal(huge)).toBeNull();
  });

  it("sums only the valid lines", () => {
    const lines = [draft(), draft({ key: "k2", qtyText: "" }), draft({ key: "k3", qtyText: "1" })];
    expect(orderTotal(lines)).toBe(984000 + 41000);
  });
});

function errorsOf(values: OrderFormValues) {
  const result = buildOrderPayload(values);
  if (result.ok) throw new Error("expected errors");
  return result.errors;
}

describe("buildOrderPayload", () => {
  it("needs a supplier and a line", () => {
    const errors = errorsOf(emptyOrderForm());
    expect(errors.supplier).toBe(orderFormMessages.supplier);
    expect(errors.lines).toBe("Add at least one line.");
  });

  it("blocks an empty quantity", () => {
    expect(errorsOf(valid([draft({ qtyText: "" })])).line["k1"]).toEqual({
      qty: "Enter the quantity.",
    });
  });

  it("asks for whole pieces", () => {
    expect(errorsOf(valid([draft({ qtyText: "1.5" })])).line["k1"]?.qty).toBe(
      "Enter a whole number of pieces.",
    );
  });

  it("asks for a quantity above 0", () => {
    expect(errorsOf(valid([draft({ qtyText: "0" })])).line["k1"]?.qty).toBe(
      "Enter a quantity above 0.",
    );
    expect(errorsOf(valid([draft({ unit: "kg", qtyText: "abc" })])).line["k1"]?.qty).toBe(
      "Enter a quantity above 0.",
    );
  });

  it("asks for a cost in rupees", () => {
    expect(errorsOf(valid([draft({ costText: "" })])).line["k1"]?.cost).toBe(
      "Enter the cost in rupees.",
    );
    expect(errorsOf(valid([draft({ costText: "1.234" })])).line["k1"]?.cost).toBe(
      "Enter the cost in rupees.",
    );
  });

  it("allows a cost of 0", () => {
    expect(buildOrderPayload(valid([draft({ costText: "0" })])).ok).toBe(true);
  });

  it("accepts kg to three places and rejects a fourth", () => {
    expect(buildOrderPayload(valid([draft({ unit: "kg", qtyText: "2.125" })])).ok).toBe(true);
    expect(
      errorsOf(valid([draft({ unit: "kg", qtyText: "2.1255" })])).line["k1"]?.qty,
    ).toBeDefined();
  });

  it("reports a line total that is too large", () => {
    const errors = errorsOf(
      valid([draft({ unit: "kg", qtyText: "1000000", costText: "9999999" })]),
    );
    expect(errors.line["k1"]?.qty).toBe("Line total is too large.");
  });

  it("reports the line cap", () => {
    const lines = Array.from({ length: 1001 }, (_, index) => draft({ key: `k${index}` }));
    expect(errorsOf(valid(lines)).lines).toBeDefined();
  });

  it("reports notes that are too long", () => {
    const errors = errorsOf({ ...valid([draft()]), notes: "x".repeat(501) });
    expect(errors.notes).toBe("Notes are up to 500 characters.");
  });

  it("builds a payload the service schema accepts", () => {
    const result = buildOrderPayload({
      ...valid([draft(), draft({ key: "k2", productId: sugar.id, unit: "kg", qtyText: "2.5" })]),
      notes: "Deliver Friday",
    });
    if (!result.ok) throw new Error("expected a payload");
    expect(result.payload.lines).toEqual([
      { productId: tea.id, orderedQtyMilli: 24000, unitCostPaisa: 41000 },
      { productId: sugar.id, orderedQtyMilli: 2500, unitCostPaisa: 41000 },
    ]);
    expect(createPurchaseOrderInputSchema.safeParse(result.payload).success).toBe(true);
  });
});

describe("formFromOrder and isOrderFormDirty", () => {
  const line: PurchaseOrderLine = {
    id: "l1",
    productId: tea.id,
    nameEn: tea.nameEn,
    nameUr: tea.nameUr,
    unit: "piece",
    orderedQtyMilli: 24000,
    unitCostPaisa: 41050,
    lineTotalPaisa: 985200,
    receivedQtyMilli: 0,
    remainingQtyMilli: 24000,
  };
  const order: PurchaseOrder = {
    id: "o1",
    orderNo: "PO-T1-000001",
    supplierId,
    supplierName: "Al-Noor",
    status: "draft",
    totalPaisa: 985200,
    lineCount: 1,
    createdAt: "2026-03-05T10:00:00.000Z",
    notes: null,
    createdByName: "Owner",
    lines: [line],
  };

  it("round-trips to the same payload", () => {
    const form = formFromOrder(order);
    expect(form).toMatchObject({ supplierId, notes: "" });
    expect(form.lines[0]).toMatchObject({ qtyText: "24", costText: "410.50" });
    const result = buildOrderPayload(form);
    if (!result.ok) throw new Error("expected a payload");
    expect(result.payload.lines).toEqual([
      { productId: tea.id, orderedQtyMilli: 24000, unitCostPaisa: 41050 },
    ]);
  });

  it("is clean for an identical form with new line keys", () => {
    expect(isOrderFormDirty(formFromOrder(order), formFromOrder(order))).toBe(false);
  });

  it("is dirty after any edit", () => {
    const initial = formFromOrder(order);
    const edit = (patch: Partial<OrderFormValues>) => ({ ...initial, ...patch });
    expect(isOrderFormDirty(initial, edit({ supplierId: null }))).toBe(true);
    expect(isOrderFormDirty(initial, edit({ notes: "x" }))).toBe(true);
    expect(isOrderFormDirty(initial, edit({ lines: [] }))).toBe(true);
    const first = initial.lines[0]!;
    expect(isOrderFormDirty(initial, edit({ lines: [{ ...first, qtyText: "25" }] }))).toBe(true);
    expect(isOrderFormDirty(initial, edit({ lines: [{ ...first, costText: "1" }] }))).toBe(true);
  });
});
