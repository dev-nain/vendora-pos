import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  Bill,
  BillResult,
  CompleteSaleInput,
  CompleteSaleResult,
} from "../../shared/checkout";
import {
  auditLog,
  products,
  saleLines,
  salePayments,
  sales,
  stockMovements,
  stores,
  taxCategories,
} from "../db/schema";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";

type Payments = CompleteSaleInput["payments"];

function okBill(result: BillResult): Bill {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.bill;
}

function okSale(result: CompleteSaleResult) {
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.message}`);
  return result.sale;
}

describe("refunds and exchanges", () => {
  let kit: CheckoutKit;

  beforeEach(() => {
    kit = createCheckoutKit();
    kit.signIn("cashier");
    kit.openShift(1000000);
  });

  afterEach(() => kit.close());

  const db = () => kit.database.db;
  const exempt = () => kit.taxCategoryId("Exempt");
  const product = (nameEn: string, salePricePaisa: number, overrides = {}) =>
    kit.addProduct({
      nameEn,
      searchText: nameEn.toLowerCase(),
      salePricePaisa,
      taxCategoryId: exempt(),
      ...overrides,
    });

  function sellProducts(items: { productId: string; qtyMilli: number }[], payments: Payments) {
    let bill: Bill | undefined;
    for (const item of items) bill = okBill(kit.billDrafts.addProduct(item));
    if (!bill) throw new Error("nothing to sell");
    return okSale(kit.sales.complete({ draftId: bill.id, payments }));
  }

  const lineOf = (saleId: string, name: string) =>
    db()
      .select()
      .from(saleLines)
      .all()
      .find((row) => row.saleId === saleId && row.nameEn === name)!;

  const returnFrom = (saleId: string, lines: { saleLineId: string; qtyMilli: number }[]) =>
    okBill(kit.returns.addFromSale({ saleId, lines }));

  function cardAndCashSale() {
    const a = product("A", 50000);
    const b = product("B", 50000);
    const sale = sellProducts(
      [
        { productId: a.id, qtyMilli: 1000 },
        { productId: b.id, qtyMilli: 1000 },
      ],
      [
        { method: "card", amountPaisa: 50000, reference: "4321" },
        { method: "cash", amountPaisa: 50000 },
      ],
    );
    return { sale, a, b, lineA: lineOf(sale.id, "A"), lineB: lineOf(sale.id, "B") };
  }

  const complete = (draftId: string, payments: Payments) =>
    kit.sales.complete({ draftId, payments });
  const movements = (productId: string) =>
    db()
      .select()
      .from(stockMovements)
      .all()
      .filter((row) => row.productId === productId);
  const auditRows = (action: string) =>
    db()
      .select()
      .from(auditLog)
      .all()
      .filter((row) => row.action === action);

  describe("quantity and amounts", () => {
    it("stops returning more than was sold across several partial returns", () => {
      const soap = product("Soap", 15000);
      const sale = sellProducts(
        [{ productId: soap.id, qtyMilli: 3000 }],
        [{ method: "cash", amountPaisa: 45000 }],
      );
      const line = lineOf(sale.id, "Soap");

      for (let i = 0; i < 2; i += 1) {
        const bill = returnFrom(sale.id, [{ saleLineId: line.id, qtyMilli: 1000 }]);
        okSale(complete(bill.id, [{ method: "cash", amountPaisa: 15000 }]));
      }

      expect(
        kit.returns.addFromSale({
          saleId: sale.id,
          lines: [{ saleLineId: line.id, qtyMilli: 2000 }],
        }),
      ).toMatchObject({ reason: "return-over-sold", message: "Only 1 left to return." });
      const last = returnFrom(sale.id, [{ saleLineId: line.id, qtyMilli: 1000 }]);
      okSale(complete(last.id, [{ method: "cash", amountPaisa: 15000 }]));
      expect(
        kit.returns.addFromSale({
          saleId: sale.id,
          lines: [{ saleLineId: line.id, qtyMilli: 1000 }],
        }),
      ).toMatchObject({ reason: "return-over-sold" });
    });

    it.each([true, false])(
      "refunds three single returns to the paisa of the original (prices include tax: %s)",
      (pricesIncludeTax) => {
        db().update(stores).set({ pricesIncludeTax }).run();
        const goods = kit.addProduct({
          nameEn: "Goods",
          searchText: "goods",
          salePricePaisa: 3333,
        });
        const draft = okBill(kit.billDrafts.addProduct({ productId: goods.id, qtyMilli: 3000 }));
        kit.billDrafts.setBillDiscount({
          draftId: draft.id,
          discount: { kind: "percent", bps: 777 },
        });
        const sale = okSale(
          kit.sales.complete({
            draftId: draft.id,
            payments: [{ method: "cash", amountPaisa: 20000 }],
          }),
        );
        const original = lineOf(sale.id, "Goods");

        for (let i = 0; i < 3; i += 1) {
          const bill = returnFrom(sale.id, [{ saleLineId: original.id, qtyMilli: 1000 }]);
          const due = -bill.totals.totalPaisa;
          okSale(complete(bill.id, [{ method: "cash", amountPaisa: due }]));
        }

        const returned = db()
          .select()
          .from(saleLines)
          .all()
          .filter((row) => row.refundedLineId === original.id);
        const sum = (pick: (row: typeof original) => number) =>
          returned.reduce((acc, row) => acc + pick(row), 0);
        expect(returned).toHaveLength(3);
        expect(sum((row) => row.grossPaisa)).toBe(-original.grossPaisa);
        expect(sum((row) => row.billDiscountPaisa)).toBe(-original.billDiscountPaisa);
        expect(sum((row) => row.taxPaisa)).toBe(-original.taxPaisa);
        expect(sum((row) => row.totalPaisa)).toBe(-original.totalPaisa);
        expect(returned.every((row) => row.totalPaisa < 0 && row.taxPaisa <= 0)).toBe(true);
      },
    );

    it("splits a weighed line into 0.400 and 0.850 kg exactly", () => {
      const rice = product("Rice", 8537, { unit: "kg" });
      const sale = sellProducts(
        [{ productId: rice.id, qtyMilli: 1250 }],
        [{ method: "cash", amountPaisa: 20000 }],
      );
      const original = lineOf(sale.id, "Rice");

      const first = returnFrom(sale.id, [{ saleLineId: original.id, qtyMilli: 400 }]);
      okSale(complete(first.id, [{ method: "cash", amountPaisa: -first.totals.totalPaisa }]));
      const second = returnFrom(sale.id, [{ saleLineId: original.id, qtyMilli: 850 }]);
      okSale(complete(second.id, [{ method: "cash", amountPaisa: -second.totals.totalPaisa }]));

      expect(-first.totals.totalPaisa - second.totals.totalPaisa).toBe(original.totalPaisa);
      expect(
        kit.returns.addFromSale({
          saleId: sale.id,
          lines: [{ saleLineId: original.id, qtyMilli: 1 }],
        }),
      ).toMatchObject({ reason: "return-over-sold" });
    });

    it("copies the original cost and tax rate and leaves the average cost alone", () => {
      const tea = kit.addProduct({ nameEn: "Tea", searchText: "tea", salePricePaisa: 10000 });
      const sale = sellProducts(
        [{ productId: tea.id, qtyMilli: 1000 }],
        [{ method: "cash", amountPaisa: 20000 }],
      );
      const original = lineOf(sale.id, "Tea");
      db().update(products).set({ costPaisa: 9500 }).where(eq(products.id, tea.id)).run();
      db()
        .update(taxCategories)
        .set({ rateBps: 500 })
        .where(eq(taxCategories.id, tea.taxCategoryId))
        .run();

      const bill = returnFrom(sale.id, [{ saleLineId: original.id, qtyMilli: 1000 }]);
      const refund = okSale(
        complete(bill.id, [{ method: "cash", amountPaisa: -bill.totals.totalPaisa }]),
      );

      expect(lineOf(refund.id, "Tea")).toMatchObject({
        costPaisa: original.costPaisa,
        taxRateBps: original.taxRateBps,
        refundedLineId: original.id,
        refundedSaleId: sale.id,
        unitPricePaisa: original.unitPricePaisa,
      });
      expect(db().select().from(products).where(eq(products.id, tea.id)).get()?.costPaisa).toBe(
        9500,
      );
      expect(db().select().from(sales).where(eq(sales.id, refund.id)).get()).toMatchObject({
        type: "refund",
        refundedSaleId: sale.id,
      });
    });
  });

  describe("completion checks", () => {
    it("re-checks the quantity when two drafts return the last unit", () => {
      const soap = product("Soap", 15000);
      const sale = sellProducts(
        [{ productId: soap.id, qtyMilli: 1000 }],
        [{ method: "cash", amountPaisa: 15000 }],
      );
      const original = lineOf(sale.id, "Soap");

      const first = returnFrom(sale.id, [{ saleLineId: original.id, qtyMilli: 1000 }]);
      expect(kit.billDrafts.hold({ draftId: first.id })).toMatchObject({ ok: true });
      const second = returnFrom(sale.id, [{ saleLineId: original.id, qtyMilli: 1000 }]);
      expect(second.id).not.toBe(first.id);

      okSale(complete(second.id, [{ method: "cash", amountPaisa: 15000 }]));
      expect(complete(first.id, [{ method: "cash", amountPaisa: 15000 }])).toMatchObject({
        ok: false,
        reason: "return-over-sold",
      });
    });

    it("refuses lines from two sales on one bill", () => {
      const soap = product("Soap", 15000);
      const a = sellProducts(
        [{ productId: soap.id, qtyMilli: 1000 }],
        [{ method: "cash", amountPaisa: 15000 }],
      );
      const b = sellProducts(
        [{ productId: soap.id, qtyMilli: 1000 }],
        [{ method: "cash", amountPaisa: 15000 }],
      );
      returnFrom(a.id, [{ saleLineId: lineOf(a.id, "Soap").id, qtyMilli: 1000 }]);
      expect(
        kit.returns.addFromSale({
          saleId: b.id,
          lines: [{ saleLineId: lineOf(b.id, "Soap").id, qtyMilli: 1000 }],
        }),
      ).toMatchObject({ reason: "one-sale" });
    });

    it("refuses a return line as the source", () => {
      const soap = product("Soap", 15000);
      const sale = sellProducts(
        [{ productId: soap.id, qtyMilli: 1000 }],
        [{ method: "cash", amountPaisa: 15000 }],
      );
      const bill = returnFrom(sale.id, [
        { saleLineId: lineOf(sale.id, "Soap").id, qtyMilli: 1000 },
      ]);
      const refund = okSale(complete(bill.id, [{ method: "cash", amountPaisa: 15000 }]));
      const returnLine = lineOf(refund.id, "Soap");

      expect(
        kit.returns.addFromSale({
          saleId: refund.id,
          lines: [{ saleLineId: returnLine.id, qtyMilli: 1000 }],
        }),
      ).toMatchObject({ reason: "not-returnable" });
      expect(kit.returns.returnable({ saleId: refund.id })).toMatchObject({
        ok: true,
        hasReturnLines: true,
        lines: [],
      });
    });
  });

  describe("stock", () => {
    it("puts a back-to-shelf return on the shelf and logs a damaged one as damage", () => {
      const soap = product("Soap", 15000);
      const tea = product("Tea", 20000);
      const sale = sellProducts(
        [
          { productId: soap.id, qtyMilli: 2000 },
          { productId: tea.id, qtyMilli: 2000 },
        ],
        [{ method: "cash", amountPaisa: 70000 }],
      );
      const bill = returnFrom(sale.id, [
        { saleLineId: lineOf(sale.id, "Soap").id, qtyMilli: 1000 },
        { saleLineId: lineOf(sale.id, "Tea").id, qtyMilli: 1000 },
      ]);
      const teaLine = bill.lines.find((line) => line.name === "Tea")!;
      okBill(kit.billDrafts.setDamaged({ lineId: teaLine.id, damaged: true }));

      const refund = okSale(complete(bill.id, [{ method: "cash", amountPaisa: 35000 }]));
      const refundLines = db()
        .select()
        .from(saleLines)
        .all()
        .filter((row) => row.saleId === refund.id);

      expect(movements(soap.id).map((m) => [m.type, m.qtyMilli, m.reason])).toEqual([
        ["sale", -2000, null],
        ["return", 1000, null],
      ]);
      expect(movements(tea.id).map((m) => [m.type, m.qtyMilli, m.reason])).toEqual([
        ["sale", -2000, null],
        ["return", 1000, null],
        ["damage", -1000, "damage"],
      ]);
      const teaMoves = movements(tea.id).filter((m) => m.type !== "sale");
      const teaRefundLine = refundLines.find((row) => row.nameEn === "Tea")!;
      expect(teaMoves.every((m) => m.sourceId === teaRefundLine.id)).toBe(true);
      expect(teaMoves.reduce((acc, m) => acc + m.qtyMilli, 0)).toBe(0);
    });

    it("writes no movement for a misc return", () => {
      kit.setMiscEnabled(true);
      const added = okBill(kit.billDrafts.addMisc({ name: "Loose", pricePaisa: 5000 }));
      const sale = okSale(complete(added.id, [{ method: "cash", amountPaisa: 5000 }]));
      const before = db().select().from(stockMovements).all().length;

      const bill = returnFrom(sale.id, [
        { saleLineId: lineOf(sale.id, "Loose").id, qtyMilli: 1000 },
      ]);
      expect(bill.lines[0]).toMatchObject({ isMisc: true, name: "Loose", totalPaisa: -5000 });
      okSale(complete(bill.id, [{ method: "cash", amountPaisa: 5000 }]));

      expect(db().select().from(stockMovements).all()).toHaveLength(before);
    });
  });

  describe("refund methods", () => {
    it("refunds a linked line to card and a receipt-less line in cash on one bill", () => {
      const { sale, lineA } = cardAndCashSale();
      const extra = product("Extra", 20000);
      returnFrom(sale.id, [{ saleLineId: lineA.id, qtyMilli: 1000 }]);
      const withExtra = okBill(kit.billDrafts.addProduct({ productId: extra.id }));
      const flipped = okBill(
        kit.billDrafts.toggleReturn({
          lineId: withExtra.lines.find((l) => l.name === "Extra")!.id,
        }),
      );
      expect(flipped.totals.totalPaisa).toBe(-70000);
      expect(flipped.refund).toMatchObject({
        linkedRefundPaisa: 50000,
        methods: [{ method: "card", availablePaisa: 50000 }],
      });

      expect(
        complete(flipped.id, [
          { method: "card", amountPaisa: 60000, reference: "9" },
          { method: "cash", amountPaisa: 10000 },
        ]),
      ).toMatchObject({
        reason: "refund-over-cap",
        message: "Card can refund up to Rs 500.",
      });
      expect(
        complete(flipped.id, [
          { method: "card", amountPaisa: 50000, reference: "9" },
          { method: "cash", amountPaisa: 10000 },
        ]),
      ).toMatchObject({ ok: false, reason: "refund-amount" });

      const refund = okSale(
        complete(flipped.id, [
          { method: "card", amountPaisa: 50000, reference: "9" },
          { method: "cash", amountPaisa: 20000 },
        ]),
      );
      const payments = db()
        .select()
        .from(salePayments)
        .all()
        .filter((p) => p.saleId === refund.id);
      expect(payments.map((p) => [p.method, p.amountPaisa, p.reference])).toEqual([
        ["card", -50000, "9"],
        ["cash", -20000, null],
      ]);
      const refundAudit = JSON.parse(auditRows("return")[0]!.details!);
      expect(refundAudit).toMatchObject({
        refundedSaleId: sale.id,
        linkedLineCount: 1,
        withoutReceiptLineCount: 1,
        refundByMethod: { card: 50000, cash: 20000 },
        returnTotalPaisa: -70000,
      });
      expect(auditRows("return_without_receipt")).toHaveLength(1);
    });

    it("stops refunding a method once it is used up, and falls back to cash", () => {
      const { sale, lineA, lineB } = cardAndCashSale();

      const first = returnFrom(sale.id, [{ saleLineId: lineA.id, qtyMilli: 1000 }]);
      okSale(complete(first.id, [{ method: "card", amountPaisa: 50000, reference: "1" }]));

      const second = returnFrom(sale.id, [{ saleLineId: lineB.id, qtyMilli: 1000 }]);
      expect(second.refund?.methods).toEqual([{ method: "card", availablePaisa: 0 }]);
      expect(
        complete(second.id, [{ method: "card", amountPaisa: 50000, reference: "2" }]),
      ).toMatchObject({ reason: "refund-over-cap", message: "Card can refund up to Rs 0." });
      okSale(complete(second.id, [{ method: "cash", amountPaisa: 50000 }]));
    });

    it("pays a net-negative exchange out of the difference", () => {
      const { sale, lineA } = cardAndCashSale();
      const cheap = product("Cheap", 12000);
      returnFrom(sale.id, [{ saleLineId: lineA.id, qtyMilli: 1000 }]);
      const bill = okBill(kit.billDrafts.addProduct({ productId: cheap.id }));
      expect(bill.totals.totalPaisa).toBe(-38000);

      const refund = okSale(
        complete(bill.id, [{ method: "card", amountPaisa: 38000, reference: "3" }]),
      );
      expect(refund).toMatchObject({ type: "refund", totalPaisa: -38000 });
      const moves = db().select().from(stockMovements).all();
      expect(moves.filter((m) => m.type === "sale").length).toBe(3);
    });

    it("pays cash only on a bill with no receipt", () => {
      const soap = product("Soap", 15000);
      const added = okBill(kit.billDrafts.addProduct({ productId: soap.id }));
      const flipped = okBill(kit.billDrafts.toggleReturn({ lineId: added.lines[0]!.id }));
      expect(flipped.refund).toBeNull();
      expect(
        complete(flipped.id, [{ method: "card", amountPaisa: 15000, reference: "1" }]),
      ).toMatchObject({
        reason: "refund-cash-only",
      });
      okSale(complete(flipped.id, [{ method: "cash", amountPaisa: 15000 }]));
      expect(auditRows("return_without_receipt")).toHaveLength(1);
    });

    it("completes an even exchange with no payment and no change", () => {
      const soap = product("Soap", 15000);
      const sale = sellProducts(
        [{ productId: soap.id, qtyMilli: 1000 }],
        [{ method: "cash", amountPaisa: 15000 }],
      );
      returnFrom(sale.id, [{ saleLineId: lineOf(sale.id, "Soap").id, qtyMilli: 1000 }]);
      const bill = okBill(kit.billDrafts.addProduct({ productId: soap.id }));
      expect(bill.totals.totalPaisa).toBe(0);

      const exchange = okSale(complete(bill.id, []));

      expect(exchange).toMatchObject({ type: "sale", totalPaisa: 0, changePaisa: 0 });
      expect(
        db()
          .select()
          .from(salePayments)
          .all()
          .filter((p) => p.saleId === exchange.id),
      ).toEqual([]);
    });
  });

  describe("rounding", () => {
    it("rounds a cash refund to the unit and refuses an unrounded amount", () => {
      db().update(stores).set({ cashRoundingEnabled: true, cashRoundingPaisa: 100 }).run();
      const soap = product("Soap", 15050);
      const sale = sellProducts(
        [{ productId: soap.id, qtyMilli: 1000 }],
        [{ method: "cash", amountPaisa: 15100 }],
      );
      const bill = returnFrom(sale.id, [
        { saleLineId: lineOf(sale.id, "Soap").id, qtyMilli: 1000 },
      ]);

      expect(complete(bill.id, [{ method: "cash", amountPaisa: 15050 }])).toMatchObject({
        reason: "cash-not-rounded",
      });
      expect(okSale(complete(bill.id, [{ method: "cash", amountPaisa: 15100 }]))).toMatchObject({
        totalPaisa: -15100,
        roundingPaisa: -50,
      });
    });
  });
});
