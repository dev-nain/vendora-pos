import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BillResult } from "../../shared/checkout";
import { UnauthenticatedError } from "../auth/errors";
import { auditLog, billDraftLines, billDrafts, products } from "../db/schema";
import { createBillDraftsService } from "./bill-drafts";
import { createCheckoutKit, scaleCode, type CheckoutKit } from "./checkout-test-kit";

function okBill(result: BillResult) {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.bill;
}

describe("bill drafts", () => {
  let kit: CheckoutKit;

  beforeEach(() => {
    kit = createCheckoutKit();
    kit.signIn("cashier");
  });

  afterEach(() => kit.close());

  const service = () => kit.billDrafts;
  const drafts = () => kit.database.db.select().from(billDrafts).all();
  const lines = () => kit.database.db.select().from(billDraftLines).all();
  const auditRows = (action: string) =>
    kit.database.db
      .select()
      .from(auditLog)
      .all()
      .filter((row) => row.action === action);

  describe("shift and session", () => {
    it("refuses every mutation with no open shift", () => {
      const product = kit.addProduct();
      kit.addBarcode(product.id, "111");
      const id = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
      const refused = { ok: false, reason: "no-open-shift" };
      expect(service().scan({ barcode: "111" })).toMatchObject(refused);
      expect(service().addProduct({ productId: product.id })).toMatchObject(refused);
      expect(service().addMisc({ name: "x", pricePaisa: 100 })).toMatchObject(refused);
      expect(service().updateLine({ lineId: id, qtyMilli: 1000 })).toMatchObject(refused);
      expect(service().deleteLine({ lineId: id })).toMatchObject(refused);
      expect(service().setBillDiscount({ draftId: id, discount: null })).toMatchObject(refused);
      expect(service().hold({ draftId: id })).toMatchObject(refused);
      expect(service().resume({ draftId: id })).toMatchObject(refused);
      expect(service().discard({ draftId: id })).toMatchObject(refused);
      expect(service().current()).toEqual({ bill: null });
      expect(service().listHeld()).toEqual([]);
      expect(drafts()).toHaveLength(0);
    });

    it("needs a session", () => {
      kit.sessions.end();
      expect(() => service().current()).toThrow(UnauthenticatedError);
    });
  });

  describe("adding and merging", () => {
    beforeEach(() => kit.openShift());

    it("creates the draft from the first line and merges the same barcode", () => {
      const product = kit.addProduct();
      kit.addBarcode(product.id, "111");

      const first = okBill(service().scan({ barcode: "111" }));
      const second = okBill(service().scan({ barcode: "111" }));

      expect(drafts()).toHaveLength(1);
      expect(second.id).toBe(first.id);
      expect(second.lines).toHaveLength(1);
      expect(second.lines[0]).toMatchObject({ qtyMilli: 2000, totalPaisa: 20000 });
    });

    it("keeps lines apart when price, discount or pack differ", () => {
      const product = kit.addProduct();
      kit.addBarcode(product.id, "111");
      kit.addBarcode(product.id, "112", { packQtyMilli: 24000, salePricePaisa: 200000 });

      okBill(service().scan({ barcode: "111" }));
      const withPack = okBill(service().scan({ barcode: "112" }));
      expect(withPack.lines).toHaveLength(2);
      expect(withPack.lines[1]).toMatchObject({
        packQtyMilli: 24000,
        unitPricePaisa: 200000,
        qtyMilli: 1000,
      });

      const lineId = withPack.lines[0]!.id;
      okBill(service().updateLine({ lineId, discount: { kind: "percent", bps: 500 } }));
      expect(okBill(service().scan({ barcode: "111" })).lines).toHaveLength(3);

      okBill(service().updateLine({ lineId, discount: null, unitPricePaisa: 9000 }));
      const merged = okBill(service().scan({ barcode: "111" }));
      expect(merged.lines.map((line) => line.qtyMilli)).toEqual([1000, 1000, 2000]);
    });

    it("prices a pack from the unit price when it has no pack price", () => {
      const product = kit.addProduct();
      kit.addBarcode(product.id, "112", { packQtyMilli: 12000 });
      const bill = okBill(service().scan({ barcode: "112" }));
      expect(bill.lines[0]).toMatchObject({ unitPricePaisa: 120000, packQtyMilli: 12000 });
    });

    it("merges into an earlier line, not only the last", () => {
      const tea = kit.addProduct();
      const soap = kit.addProduct({ nameEn: "Soap", searchText: "soap" });
      kit.addBarcode(tea.id, "111");
      kit.addBarcode(soap.id, "222");
      okBill(service().scan({ barcode: "111" }));
      okBill(service().scan({ barcode: "222" }));

      const bill = okBill(service().scan({ barcode: "111" }));

      expect(bill.lines.map((line) => line.qtyMilli)).toEqual([2000, 1000]);
    });

    it("never merges kg, misc, manual-price, scale or return lines", () => {
      kit.setMiscEnabled(true);
      const tea = kit.addProduct();
      const rice = kit.addProduct({
        nameEn: "Rice",
        searchText: "rice",
        unit: "kg",
        salePricePaisa: 85000,
        internalCode: "00123",
      });
      kit.addBarcode(tea.id, "111");

      okBill(service().addProduct({ productId: rice.id, qtyMilli: 500 }));
      expect(
        okBill(service().addProduct({ productId: rice.id, qtyMilli: 500 })).lines,
      ).toHaveLength(2);

      okBill(service().addMisc({ name: "Tea leaf", pricePaisa: 500 }));
      expect(okBill(service().addMisc({ name: "Tea leaf", pricePaisa: 500 })).lines).toHaveLength(
        4,
      );

      okBill(service().scan({ barcode: scaleCode("21", "00123", "00412") }));
      expect(
        okBill(service().scan({ barcode: scaleCode("21", "00123", "00412") })).lines,
      ).toHaveLength(6);

      okBill(service().scan({ barcode: "111", isReturn: true }));
      const returns = okBill(service().scan({ barcode: "111", isReturn: true }));
      expect(returns.lines.filter((line) => line.isReturn)).toHaveLength(2);

      const manual = okBill(service().scan({ barcode: "111" }));
      const lineId = manual.lines.find((line) => !line.isReturn && line.productId === tea.id)!.id;
      okBill(service().updateLine({ lineId, unitPricePaisa: 9000 }));
      const after = okBill(service().scan({ barcode: "111" }));
      expect(
        after.lines.filter((line) => line.productId === tea.id && !line.isReturn),
      ).toHaveLength(2);
    });

    it("signs return lines and mirrors the sale price", () => {
      const tea = kit.addProduct();
      kit.addBarcode(tea.id, "111");
      const bill = okBill(service().scan({ barcode: "111", isReturn: true }));
      expect(bill.lines[0]).toMatchObject({ qtyMilli: -1000, isReturn: true, totalPaisa: -10000 });
    });

    it("refuses an unknown barcode and the system product", () => {
      expect(service().scan({ barcode: "nope" })).toMatchObject({
        ok: false,
        reason: "product-not-found",
      });
      const misc = kit.database.db
        .select()
        .from(products)
        .where(eq(products.isSystem, true))
        .get()!;
      expect(service().addProduct({ productId: misc.id })).toMatchObject({
        reason: "product-not-found",
      });
    });

    it("refuses fractional pieces", () => {
      const tea = kit.addProduct();
      expect(service().addProduct({ productId: tea.id, qtyMilli: 1500 })).toMatchObject({
        ok: false,
        reason: "whole-units",
      });
      const bill = okBill(service().addProduct({ productId: tea.id, qtyMilli: 2000 }));
      expect(service().updateLine({ lineId: bill.lines[0]!.id, qtyMilli: 2500 })).toMatchObject({
        reason: "whole-units",
      });
    });

    it("refuses a discount on a return line", () => {
      const tea = kit.addProduct();
      const bill = okBill(service().addProduct({ productId: tea.id, isReturn: true }));
      expect(
        service().updateLine({
          lineId: bill.lines[0]!.id,
          discount: { kind: "percent", bps: 100 },
        }),
      ).toMatchObject({ reason: "return-discount" });
    });

    it("refuses misc while it is switched off", () => {
      expect(service().addMisc({ name: "x", pricePaisa: 100 })).toMatchObject({
        reason: "misc-disabled",
      });
    });

    it("adds misc as a manual-price line named by the cashier", () => {
      kit.setMiscEnabled(true);
      const bill = okBill(service().addMisc({ name: "Loose tea", pricePaisa: 45000 }));
      expect(bill.lines[0]).toMatchObject({
        name: "Loose tea",
        isMisc: true,
        priceType: "manual",
        totalPaisa: 45000,
      });
    });

    it("changes qty, price and discount and recomputes totals", () => {
      const tea = kit.addProduct({ taxCategoryId: kit.taxCategoryId("Exempt") });
      const bill = okBill(service().addProduct({ productId: tea.id }));
      const edited = okBill(
        service().updateLine({
          lineId: bill.lines[0]!.id,
          qtyMilli: 3000,
          unitPricePaisa: 5000,
          discount: { kind: "amount", amountPaisa: 1500 },
        }),
      );
      expect(edited.lines[0]).toMatchObject({
        qtyMilli: 3000,
        unitPricePaisa: 5000,
        priceType: "manual",
        grossPaisa: 15000,
        lineDiscountPaisa: 1500,
        totalPaisa: 13500,
      });
      expect(edited.totals).toMatchObject({ subtotalPaisa: 15000, discountPaisa: 1500 });
    });

    it("sets and clears a bill discount", () => {
      const tea = kit.addProduct({ taxCategoryId: kit.taxCategoryId("Exempt") });
      const bill = okBill(service().addProduct({ productId: tea.id }));
      const discounted = okBill(
        service().setBillDiscount({
          draftId: bill.id,
          discount: { kind: "percent", bps: 1000 },
        }),
      );
      expect(discounted.totals).toMatchObject({ discountPaisa: 1000, totalPaisa: 9000 });
      expect(
        okBill(service().setBillDiscount({ draftId: bill.id, discount: null })).totals.totalPaisa,
      ).toBe(10000);
    });

    it("taxes inclusively using the store rate for the standard category", () => {
      const tea = kit.addProduct({ salePricePaisa: 11800 });
      const bill = okBill(service().addProduct({ productId: tea.id }));
      expect(bill.lines[0]).toMatchObject({ taxRateBps: 1800, taxPaisa: 1800 });
      expect(bill.pricesIncludeTax).toBe(true);
      expect(bill.cashRounding).toEqual({ mode: "off", unitPaisa: 100 });
    });
  });

  describe("scale labels", () => {
    beforeEach(() => {
      kit.openShift();
      kit.addProduct({
        nameEn: "Rice",
        searchText: "rice",
        unit: "kg",
        salePricePaisa: 85000,
        internalCode: "00123",
      });
      kit.addProduct({
        nameEn: "Gum",
        searchText: "gum",
        unit: "piece",
        salePricePaisa: 2500,
        internalCode: "00456",
      });
      kit.addProduct({
        nameEn: "Free",
        searchText: "free",
        unit: "kg",
        salePricePaisa: 0,
        internalCode: "00789",
      });
    });

    it("adds a weight label at its weight", () => {
      const bill = okBill(service().scan({ barcode: scaleCode("21", "00123", "00412") }));
      expect(bill.lines[0]).toMatchObject({
        qtyMilli: 412,
        scaleSource: "weight",
        grossPaisa: 35020,
      });
    });

    it("sets the quantity from a price label on a kg product and fixes the total", () => {
      const bill = okBill(service().scan({ barcode: scaleCode("22", "00123", "00350") }));
      expect(bill.lines[0]).toMatchObject({
        qtyMilli: 412,
        scaleSource: "price",
        grossPaisa: 35000,
        totalPaisa: 35000,
      });
    });

    it("adds one piece at the label price for a piece product", () => {
      const bill = okBill(service().scan({ barcode: scaleCode("22", "00456", "00050") }));
      expect(bill.lines[0]).toMatchObject({ qtyMilli: 1000, grossPaisa: 5000 });
    });

    it("refuses a price label on an item with no price", () => {
      expect(service().scan({ barcode: scaleCode("22", "00789", "00050") })).toMatchObject({
        reason: "no-price",
      });
      expect(drafts()).toHaveLength(0);
    });

    it("refuses qty and price edits on a price-label line but allows discount and delete", () => {
      const bill = okBill(service().scan({ barcode: scaleCode("22", "00123", "00350") }));
      const lineId = bill.lines[0]!.id;
      expect(service().updateLine({ lineId, qtyMilli: 500 })).toMatchObject({
        reason: "scale-line",
      });
      expect(service().updateLine({ lineId, unitPricePaisa: 100 })).toMatchObject({
        reason: "scale-line",
      });
      const discounted = okBill(
        service().updateLine({ lineId, discount: { kind: "percent", bps: 1000 } }),
      );
      expect(discounted.lines[0]?.lineDiscountPaisa).toBe(3500);
      expect(okBill(service().deleteLine({ lineId })).lines).toHaveLength(0);
    });
  });

  describe("delete, hold, resume and discard", () => {
    let tea: ReturnType<CheckoutKit["addProduct"]>;
    let soap: ReturnType<CheckoutKit["addProduct"]>;
    let shiftId: string;

    beforeEach(() => {
      shiftId = kit.openShift();
      tea = kit.addProduct();
      soap = kit.addProduct({ nameEn: "Soap", searchText: "soap", salePricePaisa: 5000 });
    });

    it("soft-deletes a line and audits it without names", () => {
      const bill = okBill(service().addProduct({ productId: tea.id, qtyMilli: 2000 }));
      const after = okBill(service().deleteLine({ lineId: bill.lines[0]!.id }));

      expect(after.lines).toHaveLength(0);
      expect(after.deletedLineCount).toBe(1);
      expect(lines()[0]?.deletedAt).not.toBeNull();
      const rows = auditRows("line_delete");
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0]!.details!)).toEqual({
        draftId: bill.id,
        productId: tea.id,
        qtyMilli: 2000,
        grossPaisa: 20000,
      });
      expect(service().deleteLine({ lineId: bill.lines[0]!.id })).toMatchObject({
        reason: "not-found",
      });
    });

    it("numbers a new line after deleted ones", () => {
      const bill = okBill(service().addProduct({ productId: tea.id }));
      service().deleteLine({ lineId: bill.lines[0]!.id });
      const next = okBill(service().addProduct({ productId: soap.id }));
      expect(next.lines[0]?.position).toBe(1);
    });

    it("holds the current bill so nothing is current, and refuses an empty one", () => {
      const bill = okBill(service().addProduct({ productId: tea.id }));
      expect(service().hold({ draftId: bill.id })).toEqual({ ok: true });
      expect(service().current()).toEqual({ bill: null });
      expect(service().listHeld()).toEqual([
        expect.objectContaining({ id: bill.id, totalPaisa: 10000 }),
      ]);

      const fresh = okBill(service().addProduct({ productId: soap.id }));
      expect(fresh.id).not.toBe(bill.id);
      service().deleteLine({ lineId: fresh.lines[0]!.id });
      expect(service().hold({ draftId: fresh.id })).toMatchObject({ reason: "empty-bill" });
    });

    it("summarises held bills by cashier, item count and first item names, oldest first", () => {
      const first = okBill(service().addProduct({ productId: tea.id }));
      service().addProduct({ productId: soap.id });
      service().hold({ draftId: first.id });
      const second = okBill(service().addProduct({ productId: soap.id }));
      service().hold({ draftId: second.id });

      const held = service().listHeld();

      expect(held.map((bill) => bill.id)).toEqual([first.id, second.id]);
      expect(held.map((bill) => bill.lineCount)).toEqual([2, 1]);
      expect(held[0]?.itemNames).toHaveLength(2);
      expect(held[0]?.cashier).toEqual(expect.any(String));
      expect(held[0]).not.toHaveProperty("label");
    });

    it("resumes a held bill and holds the current non-empty one", () => {
      const first = okBill(service().addProduct({ productId: tea.id }));
      service().hold({ draftId: first.id });
      const second = okBill(service().addProduct({ productId: soap.id }));

      const resumed = okBill(service().resume({ draftId: first.id }));

      expect(resumed.id).toBe(first.id);
      expect(resumed.heldAt).toBeNull();
      expect(service().current().bill?.id).toBe(first.id);
      expect(
        service()
          .listHeld()
          .map((bill) => bill.id),
      ).toEqual([second.id]);
    });

    it("cancels an empty current bill when another is resumed", () => {
      const first = okBill(service().addProduct({ productId: tea.id }));
      service().hold({ draftId: first.id });
      const second = okBill(service().addProduct({ productId: soap.id }));
      service().deleteLine({ lineId: second.lines[0]!.id });

      okBill(service().resume({ draftId: first.id }));

      expect(drafts().find((draft) => draft.id === second.id)?.state).toBe("cancelled");
      expect(auditRows("bill_discard")).toHaveLength(0);
    });

    it("reuses an empty current draft for the next line", () => {
      const first = okBill(service().addProduct({ productId: tea.id }));
      service().deleteLine({ lineId: first.lines[0]!.id });
      const next = okBill(service().addProduct({ productId: soap.id }));
      expect(next.id).toBe(first.id);
      expect(drafts()).toHaveLength(1);
    });

    it("discards with an audit entry for a non-empty bill only", () => {
      const bill = okBill(service().addProduct({ productId: tea.id }));
      expect(service().discard({ draftId: bill.id })).toEqual({ ok: true });
      expect(drafts()[0]?.state).toBe("cancelled");
      const rows = auditRows("bill_discard");
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0]!.details!)).toEqual({ lineCount: 1, totalPaisa: 10000 });

      const empty = okBill(service().addProduct({ productId: tea.id }));
      service().deleteLine({ lineId: empty.lines[0]!.id });
      service().discard({ draftId: empty.id });
      expect(auditRows("bill_discard")).toHaveLength(1);
      expect(service().discard({ draftId: empty.id })).toMatchObject({ reason: "not-found" });
    });

    it("survives a restart: a new service sees the same current bill and held list", () => {
      const first = okBill(service().addProduct({ productId: tea.id }));
      service().hold({ draftId: first.id });
      const second = okBill(service().addProduct({ productId: soap.id }));

      const restarted = createBillDraftsService({
        database: kit.database,
        audit: kit.audit,
        sessions: kit.sessions,
      });

      expect(restarted.current().bill).toEqual(second);
      expect(restarted.listHeld()).toEqual(service().listHeld());
    });

    it("counts the current non-empty bill for the close check and skips empty ones", () => {
      const bill = okBill(service().addProduct({ productId: tea.id }));
      expect(
        service()
          .heldBillsFor(shiftId)
          .map((row) => row.id),
      ).toEqual([bill.id]);

      service().deleteLine({ lineId: bill.lines[0]!.id });
      expect(service().heldBillsFor(shiftId)).toEqual([]);
    });

    it("looks up lines and drafts by id within the store", () => {
      expect(
        service().deleteLine({ lineId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" }),
      ).toMatchObject({ reason: "not-found" });
      expect(
        service().setBillDiscount({
          draftId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
          discount: null,
        }),
      ).toMatchObject({ reason: "not-found" });
    });
  });
});
