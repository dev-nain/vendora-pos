import { describe, expect, it } from "vitest";

import type { PurchaseReturnableNote, PurchaseReturnableResult } from "@shared/purchase-returns";
import {
  addSupplierLine,
  buildReturnPayload,
  emptyReturnForm,
  isReturnFormDirty,
  matchReturnScan,
  returnFormFromNote,
  returnFormMessages,
  returnTotal,
  type ReturnFormValues,
  type ReturnLineDraft,
  type ReturnSource,
} from "./return-form";
import { orderFormMessages } from "./order-form";

const supplierId = "01900000-0000-7000-8000-0000000000aa";
const noteId = "01900000-0000-7000-8000-0000000000bb";
const teaId = "01900000-0000-7000-8000-000000000001";
const sugarId = "01900000-0000-7000-8000-000000000002";
const teaLineId = "01900000-0000-7000-8000-0000000000c1";
const sugarLineId = "01900000-0000-7000-8000-0000000000c2";

const note = (
  overrides: Partial<PurchaseReturnableNote["lines"][number]>[] = [],
): PurchaseReturnableNote => ({
  ok: true,
  note: {
    id: noteId,
    grnNo: "GRN-T1-000001",
    supplierId,
    supplierName: "Al-Noor",
    supplierInvoiceNo: "INV-1",
    createdAt: "2026-03-05T10:00:00.000Z",
  },
  lines: [
    {
      goodsReceivedLineId: teaLineId,
      productId: teaId,
      nameEn: "Tapal Danedar",
      nameUr: null,
      unit: "piece",
      receivedQtyMilli: 48000,
      unitCostPaisa: 10000,
      returnableQtyMilli: 42000,
      ...overrides[0],
    },
    {
      goodsReceivedLineId: sugarLineId,
      productId: sugarId,
      nameEn: "Sugar",
      nameUr: null,
      unit: "kg",
      receivedQtyMilli: 10000,
      unitCostPaisa: 15000,
      returnableQtyMilli: 10000,
      ...overrides[1],
    },
  ],
});

const returnable = (
  overrides: Partial<Extract<PurchaseReturnableResult, { ok: true }>> = {},
): Extract<PurchaseReturnableResult, { ok: true }> => ({
  ok: true,
  product: { id: teaId, nameEn: "Tapal Danedar", nameUr: null, unit: "piece" },
  unitCostPaisa: 10000,
  returnableQtyMilli: 48000,
  ...overrides,
});

const noteSource = (): ReturnSource => ({ kind: "note", note: note() });
const supplierSource: ReturnSource = { kind: "supplier" };

const withQty = (values: ReturnFormValues, ...qtyTexts: string[]): ReturnFormValues => ({
  ...values,
  lines: values.lines.map((line, index) => ({ ...line, qtyText: qtyTexts[index] ?? line.qtyText })),
});

const supplierForm = (qtyText: string, overrides: Partial<ReturnFormValues> = {}) => {
  const added = addSupplierLine([], returnable(), 0);
  return {
    ...emptyReturnForm(),
    supplierId,
    reason: "damaged" as const,
    ...overrides,
    lines: added.lines.map((line) => ({ ...line, qtyText })),
  };
};

const noteForm = (...qtyTexts: string[]) =>
  withQty({ ...returnFormFromNote(note()), reason: "expired" }, ...qtyTexts);

describe("returnFormFromNote", () => {
  it("starts every line at 0 and takes the supplier from the note", () => {
    const form = returnFormFromNote(note());
    expect(form.supplierId).toBe(supplierId);
    expect(form.reason).toBeNull();
    expect(
      form.lines.map((line) => [line.qtyText, line.costText, line.returnableQtyMilli]),
    ).toEqual([
      ["0", "100", 42000],
      ["0", "150", 10000],
    ]);
    expect(form.lines.map((line) => line.goodsReceivedLineId)).toEqual([teaLineId, sugarLineId]);
  });

  it("drops lines with nothing left to return", () => {
    const form = returnFormFromNote(note([{}, { returnableQtyMilli: 0 }]));
    expect(form.lines.map((line) => line.productId)).toEqual([teaId]);
  });
});

describe("matchReturnScan", () => {
  it("finds a line already on the form", () => {
    const lines = returnFormFromNote(note()).lines;
    expect(matchReturnScan(lines, noteSource(), sugarId)).toEqual({
      kind: "existing",
      key: lines[1]!.key,
    });
  });

  it("adds a new product from a supplier and refuses one not on the note", () => {
    expect(matchReturnScan([], supplierSource, teaId)).toEqual({ kind: "new" });
    expect(matchReturnScan([], noteSource(), teaId)).toEqual({ kind: "not-on-note" });
  });
});

describe("addSupplierLine", () => {
  it("adds a line with the pack quantity and the main-side cost", () => {
    const { lines, key } = addSupplierLine([], returnable(), 24000);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      key,
      productId: teaId,
      qtyText: "24",
      costText: "100",
      goodsReceivedLineId: null,
      returnableQtyMilli: 48000,
    });
  });

  it("leaves the quantity blank for a scale barcode", () => {
    expect(addSupplierLine([], returnable(), 0).lines[0]?.qtyText).toBe("");
  });
});

describe("buildReturnPayload", () => {
  it("needs a supplier on the supplier source", () => {
    const result = buildReturnPayload(supplierSource, supplierForm("1", { supplierId: null }));
    expect(result).toMatchObject({ ok: false, errors: { supplier: orderFormMessages.supplier } });
  });

  it("needs a reason", () => {
    const result = buildReturnPayload(supplierSource, supplierForm("1", { reason: null }));
    expect(result).toMatchObject({ ok: false, errors: { reason: returnFormMessages.reason } });
  });

  it("flags a blank quantity, a fractional piece and a zero on a supplier line", () => {
    const blank = supplierForm("");
    const fractional = supplierForm("1.5");
    const zero = supplierForm("0");
    for (const form of [blank, fractional, zero]) {
      const result = buildReturnPayload(supplierSource, form);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.line[form.lines[0]!.key]?.qty).toBeTruthy();
    }
  });

  it("refuses more than is left to return", () => {
    const form = supplierForm("50");
    const result = buildReturnPayload(supplierSource, form);
    expect(result).toMatchObject({
      ok: false,
      errors: { line: { [form.lines[0]!.key]: { qty: "Only 48 pcs left to return." } } },
    });
  });

  it("builds a supplier payload with no cost keys", () => {
    const result = buildReturnPayload(supplierSource, supplierForm("6", { notes: " Crushed " }));
    expect(result).toEqual({
      ok: true,
      payload: {
        kind: "supplier",
        supplierId,
        reason: "damaged",
        notes: " Crushed ",
        lines: [{ productId: teaId, qtyMilli: 6000 }],
      },
    });
  });

  it("builds a note payload and leaves a zero line out", () => {
    const result = buildReturnPayload(noteSource(), noteForm("0", "2.5"));
    expect(result).toEqual({
      ok: true,
      payload: {
        kind: "note",
        goodsReceivedNoteId: noteId,
        reason: "expired",
        notes: "",
        lines: [{ goodsReceivedLineId: sugarLineId, qtyMilli: 2500 }],
      },
    });
  });

  it("refuses a note with every line at zero", () => {
    expect(buildReturnPayload(noteSource(), noteForm("0", "0"))).toMatchObject({
      ok: false,
      errors: { lines: returnFormMessages.noNoteQuantities },
    });
  });

  it("refuses a supplier form with no lines", () => {
    expect(buildReturnPayload(supplierSource, { ...supplierForm("1"), lines: [] })).toMatchObject({
      ok: false,
      errors: { lines: orderFormMessages.noLines },
    });
  });

  it("puts the error on the right row after a zero line is left out", () => {
    const form = noteForm("0", "11");
    const result = buildReturnPayload(noteSource(), form);
    expect(result).toMatchObject({
      ok: false,
      errors: { line: { [form.lines[1]!.key]: { qty: "Only 10.000 kg left to return." } } },
    });
  });

  it("refuses notes over 500 characters", () => {
    const result = buildReturnPayload(
      supplierSource,
      supplierForm("1", { notes: "x".repeat(501) }),
    );
    expect(result).toMatchObject({ ok: false, errors: { notes: expect.any(String) } });
  });
});

describe("returnTotal", () => {
  it("rounds a kg line half-up", () => {
    const line: ReturnLineDraft = {
      key: "k",
      productId: sugarId,
      nameEn: "Sugar",
      nameUr: null,
      unit: "kg",
      qtyText: "0.5",
      costText: "0.01",
      goodsReceivedLineId: null,
      returnableQtyMilli: 1000,
    };
    expect(returnTotal([line])).toBe(1);
  });
});

describe("isReturnFormDirty", () => {
  it("compares supplier, reason, notes and lines", () => {
    const initial = returnFormFromNote(note());
    expect(isReturnFormDirty(initial, initial)).toBe(false);
    expect(isReturnFormDirty(initial, { ...initial, reason: "damaged" })).toBe(true);
    expect(isReturnFormDirty(initial, { ...initial, notes: "x" })).toBe(true);
    expect(isReturnFormDirty(initial, withQty(initial, "3"))).toBe(true);
    expect(isReturnFormDirty(emptyReturnForm(), { ...emptyReturnForm(), supplierId })).toBe(true);
  });
});
