import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BillResult, CompleteSaleInput, CompleteSaleResult } from "../../shared/checkout";
import { UnauthenticatedError } from "../auth/errors";
import {
  auditLog,
  billDrafts,
  receiptPrints,
  saleLines,
  salePayments,
  sales,
  stockMovements,
  stores,
} from "../db/schema";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { createSalesService } from "./sales";
import { createStockService, type StockService } from "./stock";

function draftIdOf(result: BillResult): string {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.bill.id;
}

function saleOf(result: CompleteSaleResult) {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.sale;
}

describe("complete a sale", () => {
  let kit: CheckoutKit;
  let stock: StockService;
  let service: ReturnType<typeof createSalesService>;

  beforeEach(() => {
    kit = createCheckoutKit();
    stock = createStockService({ database: kit.database, audit: kit.audit });
    service = createSalesService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      stock,
    });
  });

  afterEach(() => kit.close());

  const db = () => kit.database.db;
  const complete = (draftId: string, payments: CompleteSaleInput["payments"], buyer?: object) =>
    service.complete({ draftId, payments, ...(buyer ? { buyer } : {}) });
  const auditRows = (action: string) =>
    db()
      .select()
      .from(auditLog)
      .all()
      .filter((row) => row.action === action);
  const exempt = () => kit.taxCategoryId("Exempt");
  const price = (paisa: number, name = "Item") =>
    kit.addProduct({
      nameEn: name,
      searchText: name.toLowerCase(),
      salePricePaisa: paisa,
      taxCategoryId: exempt(),
    });
  const billOf = (productId: string, qtyMilli = 1000, isReturn = false) =>
    draftIdOf(kit.billDrafts.addProduct({ productId, qtyMilli, isReturn }));

  describe("with an open shift", () => {
    beforeEach(() => {
      kit.signIn("cashier");
      kit.openShift();
    });

    it("writes the sale, lines, payments, change, movements, draft state and audit", () => {
      const tea = kit.addProduct({ salePricePaisa: 11800, costPaisa: 8000, nameUr: "چائے" });
      const draftId = billOf(tea.id, 2000);

      const sale = saleOf(complete(draftId, [{ method: "cash", amountPaisa: 25000 }]));

      expect(sale).toMatchObject({
        invoiceNo: "T1-000001",
        type: "sale",
        totalPaisa: 23600,
        changePaisa: 1400,
        replayed: false,
      });
      const row = db().select().from(sales).get()!;
      expect(row).toMatchObject({
        draftId,
        subtotalPaisa: 23600,
        taxPaisa: 3600,
        discountPaisa: 0,
        roundingPaisa: 0,
        totalPaisa: 23600,
        pricesIncludeTax: true,
        deletedLineCount: 0,
        cashierUserId: kit.sessions.current()!.userId,
      });
      const line = db().select().from(saleLines).get()!;
      expect(line).toMatchObject({
        nameEn: "Tea",
        nameUr: "چائے",
        qtyMilli: 2000,
        unitPricePaisa: 11800,
        costPaisa: 8000,
        taxRateBps: 1800,
        grossPaisa: 23600,
        taxPaisa: 3600,
        totalPaisa: 23600,
      });
      const payments = db().select().from(salePayments).all();
      expect(payments.map((p) => [p.method, p.amountPaisa, p.isChange, p.cashierUserId])).toEqual([
        ["cash", 25000, false, row.cashierUserId],
        ["cash", -1400, true, row.cashierUserId],
      ]);
      expect(payments.reduce((a, p) => a + p.amountPaisa, 0)).toBe(row.totalPaisa);
      const movements = db().select().from(stockMovements).all();
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        type: "sale",
        qtyMilli: -2000,
        sourceType: "sale_line",
        sourceId: line.id,
        unitCostPaisa: 8000,
      });
      expect(db().select().from(billDrafts).get()?.state).toBe("paid");
      const audits = auditRows("sale_complete");
      expect(audits).toHaveLength(1);
      expect(JSON.parse(audits[0]!.details!)).toEqual({
        invoiceNo: "T1-000001",
        totalPaisa: 23600,
        lineCount: 1,
      });
      expect(auditRows("return")).toHaveLength(0);
    });

    it("returns the same sale when retried, even with different payments", () => {
      const tea = price(10000);
      const draftId = billOf(tea.id);

      const first = saleOf(complete(draftId, [{ method: "cash", amountPaisa: 10000 }]));
      const again = saleOf(complete(draftId, [{ method: "card", amountPaisa: 50000 }]));

      expect(again).toMatchObject({ id: first.id, invoiceNo: "T1-000001", replayed: true });
      expect(db().select().from(sales).all()).toHaveLength(1);
      expect(db().select().from(stockMovements).all()).toHaveLength(1);
      expect(auditRows("sale_complete")).toHaveLength(1);

      const next = saleOf(complete(billOf(tea.id), [{ method: "cash", amountPaisa: 10000 }]));
      expect(next.invoiceNo).toBe("T1-000002");
    });

    it("keeps the change on a replay", () => {
      const draftId = billOf(price(10000).id);
      complete(draftId, [{ method: "cash", amountPaisa: 15000 }]);
      expect(saleOf(complete(draftId, [])).changePaisa).toBe(5000);
    });

    it("rolls back everything when a stock movement fails", () => {
      const products = [price(1000, "A"), price(2000, "B"), price(3000, "C")];
      const draftId = billOf(products[0]!.id);
      for (const product of products.slice(1)) billOf(product.id);

      let calls = 0;
      const failing = createSalesService({
        database: kit.database,
        audit: kit.audit,
        sessions: kit.sessions,
        stock: {
          ...stock,
          record: (tx, input) => {
            calls += 1;
            if (calls === 3) throw new Error("disk full");
            return stock.record(tx, input);
          },
        },
      });

      expect(() =>
        failing.complete({ draftId, payments: [{ method: "cash", amountPaisa: 6000 }] }),
      ).toThrow("disk full");

      expect(db().select().from(sales).all()).toHaveLength(0);
      expect(db().select().from(saleLines).all()).toHaveLength(0);
      expect(db().select().from(salePayments).all()).toHaveLength(0);
      expect(db().select().from(stockMovements).all()).toHaveLength(0);
      expect(auditRows("sale_complete")).toHaveLength(0);
      expect(db().select().from(billDrafts).get()?.state).toBe("draft");

      const sale = saleOf(complete(draftId, [{ method: "cash", amountPaisa: 6000 }]));
      expect(sale.invoiceNo).toBe("T1-000001");
    });

    it("refuses a short payment with the amount due", () => {
      const draftId = billOf(price(10000).id);
      expect(complete(draftId, [{ method: "cash", amountPaisa: 4000 }])).toMatchObject({
        ok: false,
        reason: "underpaid",
        duePaisa: 6000,
      });
      expect(complete(draftId, [])).toMatchObject({ reason: "underpaid", duePaisa: 10000 });
      expect(db().select().from(sales).all()).toHaveLength(0);
    });

    it("refuses an unknown draft and an empty bill", () => {
      expect(
        complete("0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", [{ method: "cash", amountPaisa: 100 }]),
      ).toMatchObject({ reason: "not-found" });

      const draftId = billOf(price(10000).id);
      const lineId = kit.billDrafts.current().bill!.lines[0]!.id;
      kit.billDrafts.deleteLine({ lineId });
      expect(complete(draftId, [{ method: "cash", amountPaisa: 100 }])).toMatchObject({
        reason: "empty-bill",
      });
    });

    it("gives card overpay back as cash change", () => {
      const draftId = billOf(price(98000).id);
      const sale = saleOf(
        complete(draftId, [{ method: "card", amountPaisa: 100000, reference: "4821" }]),
      );
      expect(sale.changePaisa).toBe(2000);
      const payments = db().select().from(salePayments).all();
      expect(payments.map((p) => [p.method, p.amountPaisa, p.reference, p.isChange])).toEqual([
        ["card", 100000, "4821", false],
        ["cash", -2000, null, true],
      ]);
    });

    it("completes a zero-total bill with no payments", () => {
      const draftId = billOf(price(10000).id);
      kit.billDrafts.setBillDiscount({ draftId, discount: { kind: "percent", bps: 10000 } });

      const sale = saleOf(complete(draftId, []));

      expect(sale).toMatchObject({ totalPaisa: 0, type: "sale", changePaisa: 0 });
      expect(db().select().from(salePayments).all()).toHaveLength(0);
    });

    it("turns a tender on a zero-total bill into change", () => {
      const draftId = billOf(price(10000).id);
      kit.billDrafts.setBillDiscount({ draftId, discount: { kind: "percent", bps: 10000 } });
      expect(saleOf(complete(draftId, [{ method: "cash", amountPaisa: 500 }])).changePaisa).toBe(
        500,
      );
    });

    it("refunds without a receipt in cash only", () => {
      const soap = price(5000, "Soap");
      const draftId = billOf(soap.id, 1000, true);

      expect(complete(draftId, [{ method: "card", amountPaisa: 5000 }])).toMatchObject({
        reason: "refund-cash-only",
      });
      expect(complete(draftId, [{ method: "cash", amountPaisa: 4000 }])).toMatchObject({
        reason: "refund-amount",
      });
      expect(complete(draftId, [])).toMatchObject({ reason: "refund-amount" });
      expect(complete(draftId, [{ method: "cash", amountPaisa: 6000 }])).toMatchObject({
        reason: "refund-amount",
        message: "Refund exactly Rs 50.",
      });

      const sale = saleOf(complete(draftId, [{ method: "cash", amountPaisa: 5000 }]));

      expect(sale).toMatchObject({ type: "refund", totalPaisa: -5000, changePaisa: 0 });
      const payments = db().select().from(salePayments).all();
      expect(payments.map((p) => [p.method, p.amountPaisa, p.isChange])).toEqual([
        ["cash", -5000, false],
      ]);
      expect(db().select().from(stockMovements).get()).toMatchObject({
        type: "return",
        qtyMilli: 1000,
      });
      expect(auditRows("return")).toHaveLength(1);
    });

    it("completes a mixed exchange as a sale and logs the return", () => {
      const tea = price(10000, "Tea");
      const soap = price(5000, "Soap");
      const draftId = billOf(tea.id);
      billOf(soap.id, 1000, true);

      const sale = saleOf(complete(draftId, [{ method: "cash", amountPaisa: 5000 }]));

      expect(sale).toMatchObject({ type: "sale", totalPaisa: 5000 });
      const movements = db().select().from(stockMovements).all();
      expect(movements.map((m) => [m.type, m.qtyMilli]).toSorted()).toEqual([
        ["return", 1000],
        ["sale", -1000],
      ]);
      const returned = auditRows("return");
      expect(JSON.parse(returned[0]!.details!)).toEqual({
        invoiceNo: "T1-000001",
        refundedSaleId: null,
        refundedInvoiceNo: null,
        linkedLineCount: 0,
        withoutReceiptLineCount: 1,
        damagedLineCount: 0,
        returnTotalPaisa: -5000,
        refundByMethod: {},
      });
      expect(auditRows("return_without_receipt")).toHaveLength(1);
    });

    it("writes pack sales to stock in base units", () => {
      const tea = price(10000, "Tea");
      kit.addBarcode(tea.id, "112", { packQtyMilli: 24000, salePricePaisa: 200000 });
      const draftId = draftIdOf(kit.billDrafts.scan({ barcode: "112" }));

      saleOf(complete(draftId, [{ method: "cash", amountPaisa: 200000 }]));

      expect(db().select().from(stockMovements).get()?.qtyMilli).toBe(-24000);
      expect(db().select().from(saleLines).get()).toMatchObject({
        packQtyMilli: 24000,
        qtyMilli: 1000,
        barcode: "112",
      });
    });

    it("sells the misc item with a named line and no stock movement", () => {
      kit.setMiscEnabled(true);
      const draftId = draftIdOf(kit.billDrafts.addMisc({ name: "Loose tea", pricePaisa: 45000 }));

      saleOf(complete(draftId, [{ method: "cash", amountPaisa: 45000 }]));

      expect(db().select().from(saleLines).get()).toMatchObject({
        nameEn: "Loose tea",
        unitPricePaisa: 45000,
      });
      expect(db().select().from(stockMovements).all()).toHaveLength(0);
    });

    it("counts deleted lines and stores the buyer without auditing it", () => {
      const tea = price(10000, "Tea");
      const soap = price(5000, "Soap");
      const draftId = billOf(tea.id);
      const bill = kit.billDrafts.addProduct({ productId: soap.id });
      if (!bill.ok) throw new Error("add failed");
      kit.billDrafts.deleteLine({ lineId: bill.bill.lines[1]!.id });

      saleOf(
        complete(draftId, [{ method: "cash", amountPaisa: 10000 }], {
          name: "Mr Khan",
          ntn: "1234567-8",
        }),
      );

      expect(db().select().from(sales).get()).toMatchObject({
        deletedLineCount: 1,
        buyerName: "Mr Khan",
        buyerNtn: "1234567-8",
        buyerCnic: null,
      });
      const details = auditRows("sale_complete")[0]!.details!;
      expect(details).not.toContain("Khan");
      expect(details).not.toContain("Tea");
    });
  });

  describe("rounding", () => {
    beforeEach(() => {
      kit.signIn("cashier");
      kit.openShift();
    });

    it("refuses a cash tender that is not a multiple of the unit", () => {
      db().update(stores).set({ cashRoundingEnabled: true }).run();
      const draftId = billOf(price(1049).id);
      expect(complete(draftId, [{ method: "cash", amountPaisa: 1049 }])).toMatchObject({
        reason: "cash-not-rounded",
      });
      expect(db().select().from(sales).all()).toHaveLength(0);
    });

    it("rounds only the cash share of a split payment in cash-only mode", () => {
      db().update(stores).set({ cashRoundingEnabled: true }).run();
      const draftId = billOf(price(1049).id);

      const sale = saleOf(
        complete(draftId, [
          { method: "card", amountPaisa: 333 },
          { method: "cash", amountPaisa: 700 },
        ]),
      );

      expect(sale).toMatchObject({ roundingPaisa: -16, totalPaisa: 1033, changePaisa: 0 });
      expect(db().select().from(sales).get()).toMatchObject({
        subtotalPaisa: 1049,
        roundingPaisa: -16,
        totalPaisa: 1033,
      });
    });

    it("does not round a bill with no cash line", () => {
      db().update(stores).set({ cashRoundingEnabled: true }).run();
      const draftId = billOf(price(1049).id);
      const sale = saleOf(complete(draftId, [{ method: "card", amountPaisa: 1049 }]));
      expect(sale).toMatchObject({ roundingPaisa: 0, totalPaisa: 1049 });
    });

    it("rounds every bill when the store is not cash-only", () => {
      db().update(stores).set({ cashRoundingEnabled: true, cashRoundingCashOnly: false }).run();
      const draftId = billOf(price(1049).id);
      const sale = saleOf(complete(draftId, [{ method: "cash", amountPaisa: 1000 }]));
      expect(sale).toMatchObject({ roundingPaisa: -49, totalPaisa: 1000 });
    });
  });

  describe("without a shift", () => {
    it("refuses and writes nothing", () => {
      kit.signIn("cashier");
      const result = complete("0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", [
        { method: "cash", amountPaisa: 100 },
      ]);
      expect(result).toMatchObject({ ok: false, reason: "no-open-shift" });
      expect(db().select().from(sales).all()).toHaveLength(0);
      expect(
        db()
          .select()
          .from(auditLog)
          .all()
          .map((r) => r.action),
      ).not.toContain("sale_complete");
    });

    it("uses the user signed in at completion as the cashier", () => {
      const first = kit.signIn("cashier");
      kit.openShift();
      const draftId = billOf(price(1000).id);
      const second = kit.signIn("other");

      saleOf(complete(draftId, [{ method: "cash", amountPaisa: 1000 }]));

      expect(db().select().from(sales).get()?.cashierUserId).toBe(second.id);
      expect(db().select().from(billDrafts).get()?.createdBy).toBe(first.id);
      expect(
        db().select().from(salePayments).where(eq(salePayments.position, 0)).get()?.cashierUserId,
      ).toBe(second.id);
    });
  });
});

describe("order lookup", () => {
  let kit: CheckoutKit;
  let service: ReturnType<typeof createSalesService>;
  let clock: Date;

  beforeEach(() => {
    kit = createCheckoutKit();
    clock = new Date(2026, 9, 27, 10, 0);
    service = createSalesService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      stock: createStockService({ database: kit.database, audit: kit.audit }),
      now: () => clock,
    });
    kit.signIn("cashier");
  });

  afterEach(() => kit.close());

  const sell = (
    payments: CompleteSaleInput["payments"] = [{ method: "cash", amountPaisa: 10000 }],
    buyer?: object,
  ) => {
    const product = kit.addProduct({ nameEn: "Tea", salePricePaisa: 10000 });
    const added = kit.billDrafts.addProduct({ productId: product.id, qtyMilli: 1000 });
    const result = service.complete({
      draftId: draftIdOf(added),
      payments,
      ...(buyer ? { buyer } : {}),
    });
    return saleOf(result);
  };
  const invoices = (query: Parameters<typeof service.list>[0]) =>
    service.list(query).map((order) => order.invoiceNo);

  it("lists the open shift's sales newest first and nothing without a shift", () => {
    expect(service.list({ scope: "shift" })).toEqual([]);
    kit.openShift();
    sell();
    clock = new Date(2026, 9, 27, 11, 0);
    sell([{ method: "card", amountPaisa: 10000 }]);

    const orders = service.list({ scope: "shift" });

    expect(orders.map((order) => order.invoiceNo)).toEqual(["T1-000002", "T1-000001"]);
    expect(orders[0]).toMatchObject({
      cashierName: "cashier name",
      totalPaisa: 10000,
      type: "sale",
      methods: ["card"],
    });
  });

  it("lists payment methods without the change row, in payment order", () => {
    kit.openShift();
    sell([
      { method: "card", amountPaisa: 5000 },
      { method: "cash", amountPaisa: 6000 },
    ]);

    expect(service.list({ scope: "shift" })[0]?.methods).toEqual(["card", "cash"]);
  });

  it("finds another shift's sale by invoice number but not in the shift list", () => {
    const first = kit.openShift();
    sell();
    const closed = kit.shifts.close({
      shiftId: first,
      count: { method: "total", countedCashPaisa: 10000 },
    });
    expect(closed.ok).toBe(true);
    kit.openShift();
    sell();

    expect(invoices({ scope: "shift" })).toEqual(["T1-000002"]);
    expect(invoices({ invoiceNo: "T1-000001" })).toEqual(["T1-000001"]);
  });

  it("pads digits-only input into this terminal's format and uppercases other text", () => {
    kit.openShift();
    sell();
    sell();

    expect(invoices({ invoiceNo: "2" })).toEqual(["T1-000002"]);
    expect(invoices({ invoiceNo: "000001" })).toEqual(["T1-000001"]);
    expect(invoices({ invoiceNo: "t1-000002" })).toEqual(["T1-000002"]);
    expect(invoices({ invoiceNo: "T1-0000" })).toEqual([]);
    expect(invoices({ invoiceNo: "99" })).toEqual([]);
    expect(invoices({ invoiceNo: "1".repeat(20) })).toEqual([]);
  });

  it("searches a single local day from 00:00 to 23:59:59.999", () => {
    kit.openShift();
    const at = [
      new Date(2026, 9, 26, 23, 59, 59, 999),
      new Date(2026, 9, 27, 0, 0, 0, 0),
      new Date(2026, 9, 27, 23, 59, 59, 999),
      new Date(2026, 9, 28, 0, 0, 0, 0),
    ];
    for (const time of at) {
      clock = time;
      sell();
    }

    expect(invoices({ date: "2026-10-27" })).toEqual(["T1-000003", "T1-000002"]);
    expect(invoices({ date: "2026-10-26" })).toEqual(["T1-000001"]);
    expect(invoices({ date: "2026-10-29" })).toEqual([]);
  });

  it("returns at most the newest 200", () => {
    kit.openShift();
    const product = kit.addProduct({ salePricePaisa: 100 });
    kit.database.db.transaction(() => {
      for (let i = 0; i < 205; i++) {
        clock = new Date(2026, 9, 27, 10, 0, 0, i);
        const added = kit.billDrafts.addProduct({ productId: product.id, qtyMilli: 1000 });
        saleOf(
          service.complete({
            draftId: draftIdOf(added),
            payments: [{ method: "cash", amountPaisa: 100 }],
          }),
        );
      }
    });

    const orders = service.list({ scope: "shift" });

    expect(orders).toHaveLength(200);
    expect(orders[0]?.invoiceNo).toBe("T1-000205");
    expect(orders.at(-1)?.invoiceNo).toBe("T1-000006");
  });

  it("returns the snapshot detail with the print count", () => {
    kit.openShift();
    const sale = sell([{ method: "cash", amountPaisa: 12000 }], {
      name: "Bilal",
      ntn: "1234567-8",
    });
    kit.database.db
      .insert(receiptPrints)
      .values({
        storeId: kit.storeId,
        terminalId: kit.terminalId,
        saleId: sale.id,
        printedBy: kit.signIn("cashier").id,
      })
      .run();

    const result = service.get({ id: sale.id });

    expect(result).toMatchObject({
      ok: true,
      sale: {
        invoiceNo: "T1-000001",
        totalPaisa: 10000,
        changePaisa: 2000,
        buyerName: "Bilal",
        buyerNtn: "1234567-8",
        printCount: 1,
        payments: [{ method: "cash", amountPaisa: 12000, reference: null }],
      },
    });
    expect(result.ok && result.sale.lines).toHaveLength(1);
  });

  it("refuses an unknown sale and a missing session", () => {
    expect(service.get({ id: "0192f3a0-0000-7000-8000-000000000099" })).toMatchObject({
      ok: false,
      reason: "not-found",
    });

    kit.sessions.end();
    expect(() => service.list({ scope: "shift" })).toThrow(UnauthenticatedError);
    expect(() => service.get({ id: "0192f3a0-0000-7000-8000-000000000099" })).toThrow(
      UnauthenticatedError,
    );
  });
});
