import { describe, expect, it } from "vitest";

import type { GoodsReceivedNote } from "@shared/goods-received";
import type { BarcodeLookup } from "@shared/products";
import {
  purchaseOrderLineTotalPaisa,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type PurchaseOrderSummary,
} from "@shared/purchase-orders";
import {
  addDirectLine,
  addOrderLine,
  buildGrnPayload,
  defaultCostPaisa,
  emptyGrnForm,
  grnFormFromNote,
  grnFormFromOrder,
  grnFormMessages,
  grnTotal,
  isGrnFormDirty,
  matchScan,
  overReceipts,
  receivableOrders,
  scanQtyMilli,
  type GrnFormValues,
  type GrnLineDraft,
  type GrnSource,
} from "./grn-form";
import { orderFormMessages, type OrderProduct } from "./order-form";

const supplierId = "01900000-0000-7000-8000-0000000000aa";
const orderId = "01900000-0000-7000-8000-0000000000bb";
const teaId = "01900000-0000-7000-8000-000000000001";
const sugarId = "01900000-0000-7000-8000-000000000002";
const soapId = "01900000-0000-7000-8000-000000000003";

const tea: OrderProduct = {
  id: teaId,
  nameEn: "Tapal Danedar",
  nameUr: null,
  unit: "piece",
  costPaisa: 41000,
};
const sugar: OrderProduct = {
  id: sugarId,
  nameEn: "Sugar",
  nameUr: null,
  unit: "kg",
  costPaisa: 14333,
};

const orderLine = (overrides: Partial<PurchaseOrderLine> = {}): PurchaseOrderLine => ({
  id: "01900000-0000-7000-8000-0000000000c1",
  productId: teaId,
  nameEn: tea.nameEn,
  nameUr: null,
  unit: "piece",
  orderedQtyMilli: 24000,
  unitCostPaisa: 41000,
  lineTotalPaisa: 984000,
  receivedQtyMilli: 0,
  remainingQtyMilli: 24000,
  ...overrides,
});

const orderOf = (lines: PurchaseOrderLine[]): PurchaseOrder => ({
  id: orderId,
  orderNo: "PO-T1-000001",
  supplierId,
  supplierName: "Al-Noor",
  status: "partly_received",
  totalPaisa: 0,
  lineCount: lines.length,
  createdAt: "2024-03-10T10:00:00.000Z",
  notes: null,
  createdByName: "Owner",
  lines,
});

const partial = orderOf([
  orderLine({ receivedQtyMilli: 6000, remainingQtyMilli: 18000 }),
  orderLine({
    id: "01900000-0000-7000-8000-0000000000c2",
    productId: sugarId,
    nameEn: "Sugar",
    unit: "kg",
    orderedQtyMilli: 10000,
    unitCostPaisa: 14000,
    receivedQtyMilli: 10000,
    remainingQtyMilli: 0,
  }),
]);
const orderSource: GrnSource = { kind: "order", order: partial };
const direct: GrnSource = { kind: "direct" };

const draft = (overrides: Partial<GrnLineDraft> = {}): GrnLineDraft => ({
  key: "k1",
  productId: teaId,
  nameEn: tea.nameEn,
  nameUr: null,
  unit: "piece",
  qtyText: "6",
  costText: "410",
  purchaseOrderLineId: null,
  remainingQtyMilli: null,
  ...overrides,
});

const orderDraft = (overrides: Partial<GrnLineDraft> = {}) =>
  draft({
    purchaseOrderLineId: "01900000-0000-7000-8000-0000000000c1",
    remainingQtyMilli: 18000,
    ...overrides,
  });

const values = (lines: GrnLineDraft[], overrides: Partial<GrnFormValues> = {}): GrnFormValues => ({
  supplierId,
  supplierInvoiceNo: "INV-1",
  lines,
  ...overrides,
});

describe("grnFormFromOrder", () => {
  it("loads the remaining quantity after a partial delivery at the order's cost", () => {
    const form = grnFormFromOrder(partial);

    expect(form.supplierId).toBe(supplierId);
    expect(form.lines).toHaveLength(1);
    expect(form.lines[0]).toMatchObject({
      productId: teaId,
      qtyText: "18",
      costText: "410",
      remainingQtyMilli: 18000,
      purchaseOrderLineId: "01900000-0000-7000-8000-0000000000c1",
    });
  });

  it("leaves out fully received lines", () => {
    const form = grnFormFromOrder(partial);
    expect(form.lines.some((line) => line.productId === sugarId)).toBe(false);
  });

  it("keeps a decimal quantity for kg lines", () => {
    const form = grnFormFromOrder(
      orderOf([
        orderLine({
          productId: sugarId,
          unit: "kg",
          unitCostPaisa: 14333,
          remainingQtyMilli: 2500,
        }),
      ]),
    );
    expect(form.lines[0]).toMatchObject({ qtyText: "2.5", costText: "143.33" });
  });
});

const summary = (status: PurchaseOrderSummary["status"]): PurchaseOrderSummary => ({
  id: status,
  orderNo: status,
  supplierId,
  supplierName: "Al-Noor",
  status,
  totalPaisa: 0,
  lineCount: 1,
  createdAt: "2024-03-10T10:00:00.000Z",
});

describe("receivableOrders", () => {
  it("keeps confirmed and partly received orders", () => {
    const result = receivableOrders(
      (["draft", "confirmed", "partly_received", "received", "cancelled"] as const).map(summary),
    );
    expect(result.map((order) => order.status)).toEqual(["confirmed", "partly_received"]);
  });
});

describe("matchScan", () => {
  it("moves to an existing line", () => {
    const lines = [orderDraft({ key: "a" })];
    expect(matchScan(lines, orderSource, teaId)).toEqual({ kind: "existing", key: "a" });
    expect(matchScan([draft({ key: "b" })], direct, teaId)).toEqual({
      kind: "existing",
      key: "b",
    });
  });

  it("brings a received order line back", () => {
    const result = matchScan([], orderSource, sugarId);
    expect(result).toMatchObject({ kind: "order-line", line: { productId: sugarId } });
  });

  it("starts a new direct line", () => {
    expect(matchScan([], direct, teaId)).toEqual({ kind: "new" });
  });

  it("refuses a product that is not on the order", () => {
    expect(matchScan([], orderSource, soapId)).toEqual({ kind: "not-on-order" });
  });

  it("goes to the line with quantity remaining when a product is on two lines", () => {
    const lines = [
      orderDraft({ key: "a", remainingQtyMilli: 0 }),
      orderDraft({ key: "b", remainingQtyMilli: 5000 }),
    ];
    expect(matchScan(lines, orderSource, teaId)).toEqual({ kind: "existing", key: "b" });
    const exhausted = [
      orderDraft({ key: "a", remainingQtyMilli: 0 }),
      orderDraft({ key: "b", remainingQtyMilli: 0 }),
    ];
    expect(matchScan(exhausted, orderSource, teaId)).toEqual({ kind: "existing", key: "a" });
  });

  it("prefers an order line with quantity remaining when none is in the form", () => {
    const order = orderOf([
      orderLine({ id: "01900000-0000-7000-8000-0000000000d1", remainingQtyMilli: 0 }),
      orderLine({ id: "01900000-0000-7000-8000-0000000000d2", remainingQtyMilli: 4000 }),
    ]);
    expect(matchScan([], { kind: "order", order }, teaId)).toMatchObject({
      kind: "order-line",
      line: { id: "01900000-0000-7000-8000-0000000000d2" },
    });
  });
});

describe("adding lines", () => {
  it("adds a direct line at a pack quantity", () => {
    const { lines, key } = addDirectLine([], tea, 24000, 39000);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      key,
      productId: teaId,
      qtyText: "24",
      costText: "390",
      purchaseOrderLineId: null,
      remainingQtyMilli: null,
    });
  });

  it("starts a direct line blank for a scale barcode", () => {
    expect(addDirectLine([], sugar, 0, 14333).lines[0]?.qtyText).toBe("");
  });

  it("adds an order line with its remaining quantity and cost", () => {
    const line = orderLine({ remainingQtyMilli: 0 });
    const added = addOrderLine([], line, 24000);
    expect(added.lines[0]).toMatchObject({
      purchaseOrderLineId: line.id,
      remainingQtyMilli: 0,
      qtyText: "24",
      costText: "410",
    });
  });
});

describe("scanQtyMilli and defaultCostPaisa", () => {
  const product = {
    id: teaId,
    nameEn: "Tea",
    nameUr: null,
    unit: "piece" as const,
    salePricePaisa: 1,
    taxCategoryId: "t",
    costPaisa: 1,
  };

  it("uses the pack quantity for a barcode and nothing for a scale barcode", () => {
    const pack: BarcodeLookup = {
      source: "barcode",
      product,
      packQtyMilli: 24000,
      packPricePaisa: null,
    };
    const scale = {
      source: "scale",
      product,
      scale: { kind: "weight", weightMilli: 1500 },
    } as unknown as BarcodeLookup;
    expect(scanQtyMilli(pack)).toBe(24000);
    expect(scanQtyMilli(scale)).toBe(0);
  });

  it("prefers the last cost over the product cost", () => {
    expect(defaultCostPaisa(39000, tea)).toBe(39000);
    expect(defaultCostPaisa(null, tea)).toBe(41000);
    expect(defaultCostPaisa(0, tea)).toBe(0);
  });
});

describe("overReceipts", () => {
  it("is empty at the remaining quantity", () => {
    expect(overReceipts([orderDraft({ qtyText: "18" })])).toEqual([]);
    expect(overReceipts([orderDraft({ qtyText: "5" })])).toEqual([]);
  });

  it("reports the extra above the remaining quantity", () => {
    expect(overReceipts([orderDraft({ key: "a", qtyText: "20" })])).toEqual([
      { key: "a", nameEn: tea.nameEn, unit: "piece", extraMilli: 2000 },
    ]);
  });

  it("measures kg to three decimals", () => {
    const line = orderDraft({
      key: "s",
      unit: "kg",
      qtyText: "10.125",
      remainingQtyMilli: 10000,
    });
    expect(overReceipts([line])[0]?.extraMilli).toBe(125);
  });

  it("treats a re-added line with nothing remaining as all extra", () => {
    expect(overReceipts([orderDraft({ qtyText: "3", remainingQtyMilli: 0 })])[0]?.extraMilli).toBe(
      3000,
    );
  });

  it("ignores direct lines and unreadable quantities", () => {
    expect(overReceipts([draft({ qtyText: "999" })])).toEqual([]);
    expect(overReceipts([orderDraft({ qtyText: "x" })])).toEqual([]);
  });
});

describe("isGrnFormDirty", () => {
  it("is clean for equal forms and dirty for any change", () => {
    const base = values([draft()]);
    expect(isGrnFormDirty(base, values([draft()]))).toBe(false);
    expect(isGrnFormDirty(emptyGrnForm(), emptyGrnForm())).toBe(false);
    expect(isGrnFormDirty(base, { ...base, supplierId: null })).toBe(true);
    expect(isGrnFormDirty(base, { ...base, supplierInvoiceNo: "X" })).toBe(true);
    expect(isGrnFormDirty(base, values([draft({ qtyText: "7" })]))).toBe(true);
    expect(isGrnFormDirty(base, values([]))).toBe(true);
  });
});

describe("grnTotal", () => {
  it("rounds each line half-up like the service", () => {
    const lines = [
      draft({ unit: "kg", qtyText: "1.5", costText: "143.33" }),
      draft({ key: "k2", unit: "kg", qtyText: "0.333", costText: "99.99" }),
    ];
    expect(grnTotal(lines)).toBe(
      purchaseOrderLineTotalPaisa(1500, 14333) + purchaseOrderLineTotalPaisa(333, 9999),
    );
  });
});

describe("grnFormFromNote", () => {
  it("rebuilds read-only line drafts", () => {
    const note: GoodsReceivedNote = {
      id: "n",
      grnNo: "GRN-T1-000001",
      supplierId,
      supplierName: "Al-Noor",
      purchaseOrderId: null,
      orderNo: null,
      supplierInvoiceNo: "INV-1",
      totalPaisa: 0,
      createdAt: "2024-03-10T10:00:00.000Z",
      lines: [
        {
          id: "l1",
          productId: sugarId,
          purchaseOrderLineId: null,
          nameEn: "Sugar",
          nameUr: null,
          unit: "kg",
          qtyMilli: 2500,
          unitCostPaisa: 14333,
          lineTotalPaisa: 35833,
        },
      ],
    };
    expect(grnFormFromNote(note)).toEqual([
      {
        key: "l1",
        productId: sugarId,
        nameEn: "Sugar",
        nameUr: null,
        unit: "kg",
        qtyText: "2.5",
        costText: "143.33",
      },
    ]);
  });
});

const failure = (source: GrnSource, form: GrnFormValues) => {
  const result = buildGrnPayload(source, form);
  if (result.ok) throw new Error("expected errors");
  return result.errors;
};

describe("buildGrnPayload", () => {
  it("needs a supplier on a direct note", () => {
    expect(failure(direct, values([draft()], { supplierId: null })).supplier).toBe(
      orderFormMessages.supplier,
    );
  });

  it("rejects a blank or too long invoice number", () => {
    expect(failure(direct, values([draft()], { supplierInvoiceNo: "  " })).invoice).toBe(
      "Enter the supplier's invoice number.",
    );
    expect(failure(direct, values([draft()], { supplierInvoiceNo: "x".repeat(65) })).invoice).toBe(
      "Invoice number is up to 64 characters.",
    );
  });

  it("trims the invoice number", () => {
    const result = buildGrnPayload(direct, values([draft()], { supplierInvoiceNo: "  INV-9  " }));
    expect(result).toMatchObject({ ok: true, payload: { supplierInvoiceNo: "INV-9" } });
  });

  it("needs at least one line", () => {
    expect(failure(direct, values([])).lines).toBe(orderFormMessages.noLines);
  });

  it("flags a blank quantity, also on an order line", () => {
    expect(failure(direct, values([draft({ qtyText: "" })])).line.k1?.qty).toBe(
      orderFormMessages.qtyEmpty,
    );
    expect(failure(orderSource, values([orderDraft({ qtyText: "" })])).line.k1?.qty).toBe(
      orderFormMessages.qtyEmpty,
    );
  });

  it("flags a fractional piece", () => {
    expect(failure(direct, values([draft({ qtyText: "1.5" })])).line.k1?.qty).toBe(
      orderFormMessages.qtyWhole,
    );
  });

  it("flags a cost that is not a number", () => {
    expect(failure(direct, values([draft({ costText: "abc" })])).line.k1?.cost).toBe(
      orderFormMessages.costInvalid,
    );
  });

  it("puts a too-large line total on the right row after a zero line is left out", () => {
    const errors = failure(
      orderSource,
      values([
        orderDraft({ key: "zero", qtyText: "0" }),
        orderDraft({ key: "big", qtyText: "999999999", costText: "99999999" }),
      ]),
    );
    expect(errors.line.big?.qty).toBeDefined();
    expect(errors.line.zero).toBeUndefined();
  });

  it("refuses zero on a direct line", () => {
    expect(failure(direct, values([draft({ qtyText: "0" })])).line.k1?.qty).toBe(
      orderFormMessages.qtyPositive,
    );
  });

  it("refuses an order where every line is zero", () => {
    expect(failure(orderSource, values([orderDraft({ qtyText: "0" })])).lines).toBe(
      grnFormMessages.noOrderLines,
    );
  });

  it("builds a direct payload", () => {
    expect(buildGrnPayload(direct, values([draft({ qtyText: "6", costText: "410.50" })]))).toEqual({
      ok: true,
      payload: {
        kind: "direct",
        supplierId,
        supplierInvoiceNo: "INV-1",
        lines: [{ productId: teaId, qtyMilli: 6000, unitCostPaisa: 41050 }],
      },
    });
  });

  it("builds an order payload with only the lines that have a quantity", () => {
    const lineId = "01900000-0000-7000-8000-0000000000c1";
    const otherId = "01900000-0000-7000-8000-0000000000c9";
    const result = buildGrnPayload(
      orderSource,
      values([
        orderDraft({ key: "a", qtyText: "6", purchaseOrderLineId: lineId }),
        orderDraft({ key: "b", qtyText: "0", purchaseOrderLineId: otherId }),
      ]),
    );
    expect(result).toEqual({
      ok: true,
      payload: {
        kind: "order",
        purchaseOrderId: orderId,
        supplierInvoiceNo: "INV-1",
        lines: [{ purchaseOrderLineId: lineId, qtyMilli: 6000, unitCostPaisa: 41000 }],
      },
    });
  });
});
