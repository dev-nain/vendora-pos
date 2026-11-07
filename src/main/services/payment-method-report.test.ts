import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  paymentMethodLabels,
  paymentMethods,
  type Bill,
  type BillResult,
  type CompleteSaleResult,
  type PaymentMethod,
} from "../../shared/checkout";
import type { DocumentModel } from "../../shared/document";
import type { ReportExportFormat } from "../../shared/reports";
import { UnauthenticatedError } from "../auth/errors";
import { saleLines, shifts, stores } from "../db/schema";
import type { DocumentRenderer } from "../documents/document-window";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { createReportsService } from "./reports";
import { createSalesService } from "./sales";
import { createShiftsService } from "./shifts";

const okBill = (result: BillResult): Bill => {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.bill;
};

const okSale = (result: CompleteSaleResult) => {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.sale;
};

type PaymentInput = { method: PaymentMethod; amountPaisa: number; reference?: string };

const range = (from: string, to = from) => ({ from, to });

const rowOf = <Row extends { method: string }>(rows: Row[], method: PaymentMethod) =>
  rows.find((row) => row.method === paymentMethodLabels[method]);

const cash = (amountPaisa: number): PaymentInput => ({ method: "cash", amountPaisa });
const card = (amountPaisa: number): PaymentInput => ({
  method: "card",
  amountPaisa,
  reference: "4321",
});
describe("sales by payment method", () => {
  let kit: CheckoutKit;
  let clock: Date;
  let service: ReturnType<typeof createReportsService>;
  let sellingService: ReturnType<typeof createSalesService>;
  let shiftService: ReturnType<typeof createShiftsService>;
  let toPdf: ReturnType<typeof vi.fn<(model: DocumentModel) => Promise<Buffer>>>;
  let chooseSavePath: ReturnType<
    typeof vi.fn<(name: string, format: ReportExportFormat) => Promise<string | null>>
  >;

  beforeEach(() => {
    kit = createCheckoutKit();
    kit.signIn("cashier");
    clock = new Date("2026-11-07T10:00:00.000Z");
    sellingService = createSalesService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      stock: kit.stock,
      now: () => clock,
    });
    shiftService = createShiftsService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      heldBills: kit.billDrafts.heldBillsFor,
      now: () => clock,
    });
    toPdf = vi.fn(async () => Buffer.from("%PDF-1.4 fake"));
    chooseSavePath = vi.fn(async (name: string) => join(kit.dir, name));
    const renderer: DocumentRenderer = { toPdf, print: vi.fn(async () => "printed" as const) };
    service = createReportsService({
      database: kit.database,
      sessions: kit.sessions,
      renderer,
      chooseSavePath,
    });
  });

  afterEach(() => kit.close());

  const db = () => kit.database.db;
  const product = (name: string, salePricePaisa: number) =>
    kit.addProduct({
      nameEn: name,
      searchText: name.toLowerCase(),
      salePricePaisa,
      taxCategoryId: kit.taxCategoryId("Exempt"),
    });

  function openShiftAt(at: string): string {
    clock = new Date(at);
    const result = shiftService.open({ openingFloatPaisa: 0 });
    if (!result.ok) throw new Error("open failed");
    return result.shift.id;
  }

  function closeShiftAt(at: string, shiftId: string) {
    clock = new Date(at);
    const result = shiftService.close({
      shiftId,
      count: { method: "total", countedCashPaisa: 0 },
    });
    if (!result.ok) throw new Error("close failed");
    return result.report;
  }

  function sell(at: string, productId: string, qtyMilli: number, payments: PaymentInput[]) {
    clock = new Date(at);
    const bill = okBill(kit.billDrafts.addProduct({ productId, qtyMilli }));
    return okSale(sellingService.complete({ draftId: bill.id, payments }));
  }

  const lineOf = (saleId: string, name: string) =>
    db()
      .select()
      .from(saleLines)
      .all()
      .find((row) => row.saleId === saleId && row.nameEn === name)!;

  function refund(
    at: string,
    saleId: string,
    name: string,
    qtyMilli: number,
    payments: PaymentInput[],
  ) {
    clock = new Date(at);
    const bill = okBill(
      kit.returns.addFromSale({
        saleId,
        lines: [{ saleLineId: lineOf(saleId, name).id, qtyMilli }],
      }),
    );
    return okSale(sellingService.complete({ draftId: bill.id, payments }));
  }

  const day = range("2026-11-07");

  function expectAgreement(
    shiftId: string,
    report: {
      sales: { totalPaisa: number; byMethod: { method: string; amountPaisa: number }[] };
    },
  ) {
    const { rows, totals } = service.paymentMethods({ shiftId });
    expect(rows.map((row) => row.method)).toEqual(
      paymentMethods.map((method) => paymentMethodLabels[method]),
    );
    for (const method of paymentMethods) {
      expect(rowOf(rows, method)?.netPaisa).toBe(
        report.sales.byMethod.find((entry) => entry.method === method)?.amountPaisa,
      );
    }
    expect(totals.netPaisa).toBe(report.sales.totalPaisa);
  }

  it("deducts change from cash when a bill is split across tenders", () => {
    openShiftAt("2026-11-07T09:00:00.000Z");
    const item = product("Item", 45000);
    sell("2026-11-07T10:00:00.000Z", item.id, 1000, [card(20000), cash(30000)]);

    const { rows, totals } = service.paymentMethods({ range: day });

    expect(rowOf(rows, "cash")).toMatchObject({
      receivedPaisa: 25000,
      refundedPaisa: 0,
      netPaisa: 25000,
    });
    expect(rowOf(rows, "card")).toMatchObject({ receivedPaisa: 20000, netPaisa: 20000 });
    expect(totals).toEqual({ receivedPaisa: 45000, refundedPaisa: 0, netPaisa: 45000 });
  });

  it("receives exactly the bill total from cash alone", () => {
    openShiftAt("2026-11-07T09:00:00.000Z");
    sell("2026-11-07T10:00:00.000Z", product("Item", 10000).id, 1000, [cash(15000)]);
    expect(rowOf(service.paymentMethods({ range: day }).rows, "cash")).toMatchObject({
      receivedPaisa: 10000,
      refundedPaisa: 0,
    });
  });

  it("shows a cash refund and a card refund as positive refunded amounts", () => {
    openShiftAt("2026-11-07T09:00:00.000Z");
    const item = product("Item", 10000);
    const sale = sell("2026-11-07T10:00:00.000Z", item.id, 4000, [card(20000), cash(20000)]);
    refund("2026-11-07T11:00:00.000Z", sale.id, "Item", 1000, [cash(10000)]);
    refund("2026-11-07T12:00:00.000Z", sale.id, "Item", 1000, [card(10000)]);

    const { rows, totals } = service.paymentMethods({ range: day });

    expect(rowOf(rows, "cash")).toEqual({
      method: "Cash",
      receivedPaisa: 20000,
      refundedPaisa: 10000,
      netPaisa: 10000,
    });
    expect(rowOf(rows, "card")).toMatchObject({
      receivedPaisa: 20000,
      refundedPaisa: 10000,
      netPaisa: 10000,
    });
    expect(totals.netPaisa).toBe(totals.receivedPaisa - totals.refundedPaisa);
    for (const value of Object.values(totals)) expect(Number.isInteger(value)).toBe(true);
  });

  it("shows an exchange that pays out as refunded", () => {
    openShiftAt("2026-11-07T09:00:00.000Z");
    const sale = sell("2026-11-07T10:00:00.000Z", product("Item", 10000).id, 1000, [cash(10000)]);
    clock = new Date("2026-11-07T11:00:00.000Z");
    okBill(
      kit.returns.addFromSale({
        saleId: sale.id,
        lines: [{ saleLineId: lineOf(sale.id, "Item").id, qtyMilli: 1000 }],
      }),
    );
    const bill = okBill(kit.billDrafts.addProduct({ productId: product("Cheap", 4000).id }));
    okSale(sellingService.complete({ draftId: bill.id, payments: [cash(6000)] }));

    expect(rowOf(service.paymentMethods({ range: day }).rows, "cash")).toMatchObject({
      receivedPaisa: 10000,
      refundedPaisa: 6000,
      netPaisa: 4000,
    });
  });

  it("matches the X-report while the shift is open and the Z-report once closed", () => {
    const shiftId = openShiftAt("2026-11-07T09:00:00.000Z");
    const item = product("Item", 10000);
    const cheap = product("Cheap", 4000);
    const split = sell("2026-11-07T10:00:00.000Z", item.id, 4000, [card(20000), cash(25000)]);
    sell("2026-11-07T10:30:00.000Z", item.id, 1000, [cash(15000)]);
    refund("2026-11-07T11:00:00.000Z", split.id, "Item", 1000, [cash(10000)]);
    refund("2026-11-07T11:10:00.000Z", split.id, "Item", 1000, [card(10000)]);
    clock = new Date("2026-11-07T11:20:00.000Z");
    okBill(
      kit.returns.addFromSale({
        saleId: split.id,
        lines: [{ saleLineId: lineOf(split.id, "Item").id, qtyMilli: 1000 }],
      }),
    );
    const exchange = okBill(kit.billDrafts.addProduct({ productId: cheap.id }));
    okSale(sellingService.complete({ draftId: exchange.id, payments: [cash(6000)] }));

    const open = shiftService.report({ id: shiftId });
    if (!open.ok) throw new Error("missing report");
    expect(open.report.kind).toBe("x");
    expectAgreement(shiftId, open.report);

    const closed = closeShiftAt("2026-11-07T13:00:00.000Z", shiftId);
    expect(closed.kind).toBe("z");
    expectAgreement(shiftId, closed);
  });

  it("covers a whole shift past midnight and splits it by day", () => {
    const shiftId = openShiftAt("2026-11-07T16:00:00.000Z");
    const item = product("Item", 10000);
    sell("2026-11-07T18:00:00.000Z", item.id, 1000, [cash(10000)]);
    sell("2026-11-07T20:00:00.000Z", item.id, 2000, [card(20000)]);
    const z = closeShiftAt("2026-11-07T20:10:00.000Z", shiftId);

    const whole = service.paymentMethods({ shiftId });
    const first = service.paymentMethods({ range: range("2026-11-07") });
    const second = service.paymentMethods({ range: range("2026-11-08") });

    expect(whole.totals.netPaisa).toBe(z.sales.totalPaisa);
    expect(first.totals.netPaisa).toBe(10000);
    expect(second.totals.netPaisa).toBe(20000);
    expect(first.totals.netPaisa + second.totals.netPaisa).toBe(whole.totals.netPaisa);
    for (const method of paymentMethods) {
      expect(rowOf(whole.rows, method)?.netPaisa).toBe(
        z.sales.byMethod.find((entry) => entry.method === method)?.amountPaisa,
      );
    }
  });

  describe("shift list", () => {
    it("lists overlapping shifts newest first, including the open one", () => {
      const before = openShiftAt("2026-11-05T05:00:00.000Z");
      closeShiftAt("2026-11-05T06:00:00.000Z", before);
      const across = openShiftAt("2026-11-06T18:00:00.000Z");
      closeShiftAt("2026-11-07T06:00:00.000Z", across);
      const inside = openShiftAt("2026-11-07T08:00:00.000Z");
      closeShiftAt("2026-11-07T10:00:00.000Z", inside);
      const open = openShiftAt("2026-11-07T11:00:00.000Z");

      expect(service.reportShifts(day).map((shift) => shift.id)).toEqual([open, inside, across]);
      expect(service.reportShifts(day)[0]).toMatchObject({
        closedAt: null,
        openedBy: "cashier name",
      });
      expect(service.reportShifts(range("2026-11-06")).map((shift) => shift.id)).toEqual([across]);
      expect(service.reportShifts(range("2026-11-05")).map((shift) => shift.id)).toEqual([before]);
    });

    it("never lists or reports another store's shift", () => {
      const shiftId = openShiftAt("2026-11-07T09:00:00.000Z");
      sell("2026-11-07T10:00:00.000Z", product("Item", 10000).id, 1000, [cash(10000)]);
      const other = db().insert(stores).values({}).returning().get();
      kit.database.sqlite.pragma("foreign_keys = OFF");
      db().update(shifts).set({ storeId: other.id }).where(eq(shifts.id, shiftId)).run();
      kit.database.sqlite.prepare("UPDATE sales SET store_id = ?").run(other.id);
      kit.database.sqlite.pragma("foreign_keys = ON");

      expect(service.reportShifts(day)).toEqual([]);
      expect(service.paymentMethods({ shiftId }).rows).toEqual([]);
    });
  });

  it("gives no rows without payments and all five methods with any", () => {
    openShiftAt("2026-11-07T09:00:00.000Z");
    expect(service.paymentMethods({ range: day }).rows).toEqual([]);
    expect(service.paymentMethods({ shiftId: crypto.randomUUID() }).rows).toEqual([]);

    sell("2026-11-07T10:00:00.000Z", product("Item", 10000).id, 1000, [cash(10000)]);

    expect(service.paymentMethods({ range: day }).rows.map((row) => row.method)).toEqual([
      "Cash",
      "Card",
      "Bank transfer",
      "JazzCash",
      "Easypaisa",
    ]);
  });

  it("requires a session", () => {
    kit.sessions.end();
    expect(() => service.paymentMethods({ range: day })).toThrow(UnauthenticatedError);
    expect(() => service.reportShifts(day)).toThrow(UnauthenticatedError);
  });

  describe("export", () => {
    it("writes a range CSV with a store-day file name", async () => {
      openShiftAt("2026-11-07T09:00:00.000Z");
      sell("2026-11-07T10:00:00.000Z", product("Item", 10000).id, 1000, [cash(10000)]);

      const result = await service.exportPaymentMethods({
        range: range("2026-11-01", "2026-11-07"),
        format: "csv",
      });

      const name = "sales-by-payment-method-2026-11-01-to-2026-11-07.csv";
      expect(result).toEqual({ ok: true, status: "saved", path: join(kit.dir, name) });
      const lines = readFileSync(join(kit.dir, name), "utf8").slice(1).split("\r\n");
      expect(lines[0]).toBe("Method,Received,Refunded,Net");
      expect(lines[1]).toBe("Cash,100.00,0.00,100.00");
      expect(lines.at(-2)).toBe("Total,100.00,0.00,100.00");
    });

    it("names a shift export from its store-time opening and references the shift", async () => {
      const shiftId = openShiftAt("2026-11-07T16:00:00.000Z");
      sell("2026-11-07T17:00:00.000Z", product("Item", 10000).id, 1000, [cash(10000)]);

      const csv = await service.exportPaymentMethods({ shiftId, format: "csv" });
      const pdf = await service.exportPaymentMethods({ shiftId, format: "pdf" });

      const name = "payment-methods-shift-2026-11-07-2100.csv";
      expect(csv).toEqual({ ok: true, status: "saved", path: join(kit.dir, name) });
      expect(chooseSavePath).toHaveBeenCalledWith(name, "csv");
      expect(pdf).toMatchObject({ ok: true, status: "saved" });
      const model = toPdf.mock.calls[0]![0];
      expect(model.title).toBe("Sales by payment method");
      expect(model.reference?.startsWith("Shift ")).toBe(true);
      expect(model.columns).toHaveLength(4);
    });

    it("fails without opening the dialog for an unknown shift", async () => {
      const result = await service.exportPaymentMethods({
        shiftId: crypto.randomUUID(),
        format: "csv",
      });
      expect(result).toMatchObject({ ok: false, reason: "failed" });
      expect(chooseSavePath).not.toHaveBeenCalled();
    });

    it("returns cancelled when the dialog is cancelled", async () => {
      chooseSavePath.mockResolvedValueOnce(null);
      expect(await service.exportPaymentMethods({ range: day, format: "csv" })).toEqual({
        ok: true,
        status: "cancelled",
      });
    });
  });
});
