import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CompleteSaleInput } from "../../shared/checkout";
import { printerMessages, type PrintResult } from "../../shared/receipt";
import { UnauthenticatedError } from "../auth/errors";
import {
  auditLog,
  receiptPrints,
  saleLines,
  salePayments,
  sales,
  stockMovements,
  terminals,
} from "../db/schema";
import type { PrintJob, PrinterTransport } from "../hardware/printer-transport";
import type { Rasterise } from "../receipts/rasterise";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { createReceiptsService, opensDrawer, type ReceiptsService } from "./receipts";
import { createSalesService, type SalesService } from "./sales";
import { createStockService } from "./stock";

const ok: PrintResult = { successful: true, canRetry: false, message: "" };
const offline: PrintResult = {
  successful: false,
  canRetry: true,
  message: printerMessages.offline,
};

const rasterise: Rasterise = async () => ({
  image: { widthPx: 384, heightPx: 2, bits: new Uint8Array(96) },
});

describe("opensDrawer", () => {
  it("is true when any payment row is cash, including change and refunds", () => {
    expect(opensDrawer([{ method: "cash" }])).toBe(true);
    expect(opensDrawer([{ method: "card" }, { method: "cash" }])).toBe(true);
    expect(opensDrawer([{ method: "cash" }, { method: "cash" }])).toBe(true);
  });

  it("is false for card, bank and wallet payments with no cash row", () => {
    expect(opensDrawer([])).toBe(false);
    expect(opensDrawer([{ method: "card" }])).toBe(false);
    expect(opensDrawer([{ method: "jazzcash" }, { method: "easypaisa" }])).toBe(false);
    expect(opensDrawer([{ method: "bank_transfer" }])).toBe(false);
  });
});

describe("receipts service", () => {
  let kit: CheckoutKit;
  let salesService: SalesService;
  let service: ReceiptsService;
  let jobs: PrintJob[];
  let next: () => Promise<PrintResult>;
  let onSend: (job: PrintJob) => void;

  const transport: PrinterTransport = {
    send: async (job) => {
      jobs.push(job);
      onSend(job);
      return next();
    },
  };

  beforeEach(() => {
    kit = createCheckoutKit();
    salesService = createSalesService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      stock: createStockService({ database: kit.database, audit: kit.audit }),
    });
    jobs = [];
    next = async () => ok;
    onSend = () => undefined;
    service = createReceiptsService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      shifts: kit.shifts,
      rasterise,
      transportFor: (connection) => (connection.kind === "none" ? null : transport),
    });
    kit.signIn("cashier");
    kit.openShift();
    configure({ printerKind: "network", printerHost: "192.0.2.1", printerPort: 9100 });
  });

  afterEach(() => kit.close());

  const db = () => kit.database.db;
  const configure = (patch: Partial<typeof terminals.$inferInsert>) => {
    db().update(terminals).set(patch).run();
  };
  const auditRows = (action: string) =>
    db()
      .select()
      .from(auditLog)
      .all()
      .filter((row) => row.action === action);
  const kinds = () => jobs.map((job) => job.kind);

  function sell(payments: CompleteSaleInput["payments"], priceId = "Tea"): string {
    const product = kit.addProduct({ nameEn: priceId, salePricePaisa: 10000 });
    const bill = kit.billDrafts.addProduct({ productId: product.id, qtyMilli: 1000 });
    if (!bill.ok) throw new Error("add failed");
    const result = salesService.complete({ draftId: bill.bill.id, payments });
    if (!result.ok) throw new Error(`sale refused: ${result.reason}`);
    return result.sale.id;
  }

  const cashSale = () => sell([{ method: "cash", amountPaisa: 10000 }]);
  const cardSale = () => sell([{ method: "card", amountPaisa: 10000, reference: "4321" }]);
  const printCount = () => db().select().from(receiptPrints).all().length;

  describe("after a sale", () => {
    it("kicks the drawer for cash after the sale exists, then prints the receipt", async () => {
      const saleId = cashSale();
      let salesWhenKicked = -1;
      onSend = (job) => {
        if (job.kind === "drawer") salesWhenKicked = db().select().from(sales).all().length;
      };

      service.startAfterSale(saleId);

      expect(await service.saleJob({ saleId })).toEqual({ state: "printed" });
      expect(kinds()).toEqual(["drawer", "receipt"]);
      expect(jobs[0]?.reason).toBe("sale");
      expect(salesWhenKicked).toBe(1);
      expect(printCount()).toBe(1);
      expect(auditRows("drawer_open_no_sale")).toHaveLength(0);
    });

    it("kicks for cash change on a card sale and never for card only", async () => {
      const exact = cardSale();
      service.startAfterSale(exact);
      await service.saleJob({ saleId: exact });
      expect(kinds()).toEqual(["receipt"]);

      jobs.length = 0;
      const withChange = sell([
        { method: "card", amountPaisa: 5000 },
        { method: "cash", amountPaisa: 6000 },
      ]);
      service.startAfterSale(withChange);
      await service.saleJob({ saleId: withChange });
      expect(kinds()).toEqual(["drawer", "receipt"]);
    });

    it("does not wait for the print: the call returns before any transport I/O", () => {
      const saleId = cashSale();

      service.startAfterSale(saleId);

      expect(jobs).toHaveLength(0);
    });

    it("keeps the sale, lines, payments and stock when the transport throws", async () => {
      const saleId = cashSale();
      next = async () => {
        throw new Error("usb gone");
      };

      service.startAfterSale(saleId);
      const result = await service.saleJob({ saleId });

      expect(result).toEqual({
        state: "failed",
        canRetry: true,
        message: printerMessages.error,
      });
      expect(db().select().from(sales).all()).toHaveLength(1);
      expect(db().select().from(saleLines).all()).toHaveLength(1);
      expect(db().select().from(salePayments).all().length).toBeGreaterThanOrEqual(1);
      expect(db().select().from(stockMovements).all().length).toBeGreaterThanOrEqual(1);
      expect(printCount()).toBe(0);
    });

    it("reports a failed print with canRetry and writes no receipt_prints row", async () => {
      const saleId = cardSale();
      next = async () => offline;

      service.startAfterSale(saleId);

      expect(await service.saleJob({ saleId })).toEqual({
        state: "failed",
        canRetry: true,
        message: printerMessages.offline,
      });
      expect(printCount()).toBe(0);
      expect(db().select().from(sales).all()).toHaveLength(1);
    });

    it("still prints when the drawer kick fails", async () => {
      const saleId = cashSale();
      next = async () => (jobs.length === 1 ? offline : ok);

      service.startAfterSale(saleId);

      expect(await service.saleJob({ saleId })).toEqual({ state: "printed" });
      expect(kinds()).toEqual(["drawer", "receipt"]);
    });

    it("tells the receipt screen to ask, or that printing is off", async () => {
      const asked = cashSale();
      configure({ printMode: "ask" });
      service.startAfterSale(asked);
      expect(await service.saleJob({ saleId: asked })).toEqual({ state: "ask" });
      expect(kinds()).toEqual(["drawer"]);

      jobs.length = 0;
      const skipped = cardSale();
      configure({ printMode: "off" });
      service.startAfterSale(skipped);
      expect(await service.saleJob({ saleId: skipped })).toEqual({ state: "off" });
      expect(jobs).toHaveLength(0);
      expect(printCount()).toBe(0);
    });

    it("reports no printer in print and ask modes and stays quiet in off mode", async () => {
      configure({ printerKind: "none" });
      const first = cashSale();
      service.startAfterSale(first);
      expect(await service.saleJob({ saleId: first })).toEqual({
        state: "no-printer",
        message: printerMessages.notSetUp,
      });

      configure({ printMode: "ask" });
      const second = cardSale();
      service.startAfterSale(second);
      expect(await service.saleJob({ saleId: second })).toMatchObject({ state: "no-printer" });

      configure({ printMode: "off" });
      const third = cardSale();
      service.startAfterSale(third);
      expect(await service.saleJob({ saleId: third })).toEqual({ state: "off" });
      expect(jobs).toHaveLength(0);
    });

    it("returns none for a sale that never started a job", async () => {
      expect(await service.saleJob({ saleId: "0192f3a0-0000-7000-8000-000000000099" })).toEqual({
        state: "none",
      });
    });

    it("keeps only the newest 20 jobs", async () => {
      configure({ printMode: "off" });
      const ids: string[] = [];
      for (let i = 0; i < 21; i++) {
        ids.push(cardSale());
        service.startAfterSale(ids[i]!);
      }

      expect(await service.saleJob({ saleId: ids[0]! })).toEqual({ state: "none" });
      expect(await service.saleJob({ saleId: ids[20]! })).toEqual({ state: "off" });
    });
  });

  describe("print and reprint", () => {
    it("writes one receipt_prints row per successful print and counts reprints", async () => {
      const saleId = cashSale();
      service.startAfterSale(saleId);
      await service.saleJob({ saleId });
      expect(printCount()).toBe(1);

      expect(await service.print({ saleId })).toEqual(ok);

      expect(printCount()).toBe(2);
      const rows = db().select().from(receiptPrints).all();
      expect(rows.every((row) => row.saleId === saleId)).toBe(true);
    });

    it("writes no row for a failed retry, then one when it succeeds", async () => {
      const saleId = cardSale();
      configure({ printMode: "ask" });
      next = async () => offline;

      expect(await service.print({ saleId })).toEqual(offline);
      expect(printCount()).toBe(0);

      next = async () => ok;
      expect(await service.print({ saleId })).toEqual(ok);
      expect(printCount()).toBe(1);
    });

    it("refuses an unknown sale and a missing session, and prints with no printer as not set up", async () => {
      const missing = await service.print({ saleId: "0192f3a0-0000-7000-8000-000000000099" });
      expect(missing.successful).toBe(false);
      expect(jobs).toHaveLength(0);

      const saleId = cardSale();
      configure({ printerKind: "none" });
      expect(await service.print({ saleId })).toEqual({
        successful: false,
        canRetry: false,
        message: printerMessages.notSetUp,
      });

      kit.sessions.end();
      expect(() => service.print({ saleId })).toThrow(UnauthenticatedError);
    });

    it("sends a job that starts with init and ends with the cut", async () => {
      const saleId = cardSale();

      await service.print({ saleId });

      const bytes = jobs[0]!.bytes;
      expect([...bytes.subarray(0, 2)]).toEqual([0x1b, 0x40]);
      expect([...bytes.subarray(-4)]).toEqual([0x1d, 0x56, 66, 0]);
    });

    it("serialises jobs so a kick, a print and a reprint never interleave", async () => {
      const saleId = cashSale();
      const active = { now: 0, max: 0 };
      next = async () => {
        active.now += 1;
        active.max = Math.max(active.max, active.now);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active.now -= 1;
        return ok;
      };

      service.startAfterSale(saleId);
      await new Promise((resolve) => setImmediate(resolve));
      const reprints = [service.print({ saleId }), service.print({ saleId })];
      await Promise.all([service.saleJob({ saleId }), ...reprints]);

      expect(kinds()).toEqual(["drawer", "receipt", "receipt", "receipt"]);
      expect(active.max).toBe(1);
    });
  });

  describe("printer status", () => {
    it("is not set up with no printer, error after a failure and ok after the next print", async () => {
      expect(service.status()).toEqual({ state: "ok", message: "" });

      next = async () => offline;
      const saleId = cardSale();
      await service.print({ saleId });
      expect(service.status()).toEqual({ state: "error", message: printerMessages.error });

      next = async () => ok;
      await service.print({ saleId });
      expect(service.status()).toEqual({ state: "ok", message: "" });

      configure({ printerKind: "none" });
      expect(service.status()).toEqual({
        state: "not-set-up",
        message: printerMessages.notSetUp,
      });
    });

    it("needs a session", () => {
      kit.sessions.end();

      expect(() => service.status()).toThrow(UnauthenticatedError);
    });
  });

  describe("test print and test drawer", () => {
    it("test print sends a test job and writes no receipt_prints row or audit row", async () => {
      expect(await service.testPrint()).toEqual(ok);

      expect(kinds()).toEqual(["test"]);
      expect(printCount()).toBe(0);
      expect(auditRows("drawer_open_no_sale")).toHaveLength(0);
    });

    it("test drawer kicks and audits the test reason with the outcome", async () => {
      const user = kit.signIn("cashier");

      expect(await service.testDrawer()).toEqual(ok);
      next = async () => offline;
      expect(await service.testDrawer()).toEqual(offline);

      expect(kinds()).toEqual(["drawer", "drawer"]);
      const rows = auditRows("drawer_open_no_sale");
      expect(rows.map((row) => JSON.parse(row.details!))).toEqual([
        { reason: "test", successful: true },
        { reason: "test", successful: false },
      ]);
      expect(rows[0]?.actorUserId).toBe(user.id);
    });

    it("does nothing and audits nothing with no printer", async () => {
      configure({ printerKind: "none" });

      expect(await service.testDrawer()).toMatchObject({ successful: false, canRetry: false });
      expect(await service.testPrint()).toMatchObject({ successful: false });

      expect(jobs).toHaveLength(0);
      expect(auditRows("drawer_open_no_sale")).toHaveLength(0);
    });
  });

  describe("drawer for cash moves and counts", () => {
    it.each(["cash_in", "cash_out", "opening_count", "closing_count"] as const)(
      "kicks and audits %s",
      async (reason) => {
        expect(await service.openDrawer(reason)).toEqual(ok);

        expect(jobs[0]).toMatchObject({ kind: "drawer", reason });
        expect(auditRows("drawer_open_no_sale").map((row) => JSON.parse(row.details!))).toEqual([
          { reason, successful: true },
        ]);
      },
    );

    it("audits a failed kick as unsuccessful and never throws", async () => {
      next = async () => {
        throw new Error("boom");
      };

      expect(await service.openDrawer("cash_in")).toMatchObject({ successful: false });

      expect(auditRows("drawer_open_no_sale").map((row) => JSON.parse(row.details!))).toEqual([
        { reason: "cash_in", successful: false },
      ]);
    });

    it("writes no audit row and sends nothing with no printer", async () => {
      configure({ printerKind: "none" });

      expect(await service.openDrawer("cash_out")).toMatchObject({ successful: false });

      expect(jobs).toHaveLength(0);
      expect(auditRows("drawer_open_no_sale")).toHaveLength(0);
    });
  });

  describe("shift reports", () => {
    it("prints an X-report on request without a receipt_prints row", async () => {
      const state = kit.shifts.state();
      if (state.status !== "open") throw new Error("shift is not open");

      expect(await service.printShiftReport({ shiftId: state.shift.id })).toEqual(ok);

      expect(kinds()).toEqual(["report"]);
      expect(printCount()).toBe(0);
    });

    it("refuses an unknown shift and reports a failure", async () => {
      const unknown = await service.printShiftReport({
        shiftId: "0192f3a0-0000-7000-8000-000000000099",
      });
      expect(unknown.successful).toBe(false);
      expect(jobs).toHaveLength(0);

      const state = kit.shifts.state();
      if (state.status !== "open") throw new Error("shift is not open");
      next = async () => offline;
      expect(await service.printShiftReport({ shiftId: state.shift.id })).toEqual(offline);
      expect(service.status().state).toBe("error");
    });
  });
});
