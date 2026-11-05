import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BillResult, CompleteSaleInput } from "../../shared/checkout";
import type { HeldBillSummary } from "../../shared/shifts";
import { UnauthenticatedError } from "../auth/errors";
import { createSessionStore, type SessionStore } from "../auth/session";
import { openDatabase, type VendoraDatabase } from "../db/client";
import { runMigrations } from "../db/migrate";
import {
  auditLog,
  cashDenominations,
  shiftCashCounts,
  sales,
  shiftCashMoves,
  shifts,
  stores,
  terminals,
  users,
} from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { createAuditService } from "./audit";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { createSalesService } from "./sales";
import { createStockService } from "./stock";
import { NoOpenShiftError, createShiftsService, requireOpenShift } from "./shifts";

describe("createShiftsService", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let held: HeldBillSummary[];
  let service: ReturnType<typeof createShiftsService>;

  const storeId = () => database.db.select().from(stores).get()!.id;
  const terminalId = () => database.db.select().from(terminals).get()!.id;
  const auditRows = (action?: string) =>
    database.db
      .select()
      .from(auditLog)
      .all()
      .filter((row) => !action || row.action === action);

  const signIn = (name: string) => {
    const user =
      database.db.select().from(users).where(eq(users.username, name)).get() ??
      database.db
        .insert(users)
        .values({ username: name, displayName: `${name} name`, passwordHash: "p", pinHash: "q" })
        .returning()
        .get();
    sessions.start({ userId: user.id, storeId: storeId(), loggedInAt: new Date(0) });
    return user;
  };

  const denominationId = (valuePaisa: number) =>
    database.db
      .select()
      .from(cashDenominations)
      .where(eq(cashDenominations.valuePaisa, valuePaisa))
      .get()!.id;

  const openWith = (float: number) => {
    const result = service.open({ openingFloatPaisa: float });
    if (!result.ok) throw new Error("open failed");
    return result.shift.id;
  };

  const addMove = (kind: "in" | "out", amountPaisa: number, reason: string) => {
    const result = service.addCashMove({ kind, amountPaisa, reason });
    if (!result.ok) throw new Error("add failed");
    return result.move.id;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-shifts-service-"));
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, {
      migrationsFolder: join(process.cwd(), "drizzle"),
      backupDir: join(dir, "backups"),
    });
    seedStoreAndTerminal(database);
    sessions = createSessionStore();
    held = [];
    service = createShiftsService({
      database,
      audit: createAuditService(database),
      sessions,
      heldBills: () => held,
    });
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("open", () => {
    it("writes the shift and a shift_open row with the actor", () => {
      const user = signIn("cashier");

      const result = service.open({ openingFloatPaisa: 500000 });

      expect(result.ok).toBe(true);
      const rows = database.db.select().from(shifts).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        openedBy: user.id,
        openingFloatPaisa: 500000,
        terminalId: terminalId(),
        storeId: storeId(),
        closedAt: null,
      });
      const audit = auditRows("shift_open");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actorUserId: user.id,
        entityType: "shift",
        entityId: rows[0]!.id,
      });
      expect(JSON.parse(audit[0]!.details!)).toEqual({ openingFloatPaisa: 500000 });
    });

    it("refuses a second open shift", () => {
      signIn("cashier");
      openWith(100);

      expect(service.open({ openingFloatPaisa: 100 })).toMatchObject({
        ok: false,
        reason: "already-open",
      });
      expect(database.db.select().from(shifts).all()).toHaveLength(1);
      expect(auditRows("shift_open")).toHaveLength(1);
    });

    it("is shared between users", () => {
      signIn("cashier");
      openWith(100);
      signIn("owner");

      const state = service.state();

      expect(state.status).toBe("open");
    });

    it("refuses with no session", () => {
      expect(() => service.open({ openingFloatPaisa: 0 })).toThrow(UnauthenticatedError);
      expect(() => service.state()).toThrow(UnauthenticatedError);
      expect(() => service.listDenominations()).toThrow(UnauthenticatedError);
    });
  });

  describe("state", () => {
    it("suggests 0 at first, then the last counted cash", () => {
      signIn("cashier");
      expect(service.state()).toEqual({ status: "closed", suggestedFloatPaisa: 0 });

      const id = openWith(1000);
      service.close({ shiftId: id, count: { method: "total", countedCashPaisa: 7777 } });

      expect(service.state()).toEqual({ status: "closed", suggestedFloatPaisa: 7777 });
    });

    it("returns the X-report, held bills and the variance threshold when open", () => {
      signIn("cashier");
      database.db.update(stores).set({ shiftVarianceWarnPaisa: 150 }).run();
      held = [{ id: "b1", label: "Bill 1", totalPaisa: 500, heldAt: new Date(0).toISOString() }];
      openWith(5000);

      const state = service.state();

      expect(state.status).toBe("open");
      if (state.status !== "open") return;
      expect(state.report.kind).toBe("x");
      expect(state.report.openingFloatPaisa).toBe(5000);
      expect(state.report.terminalCode).toBe("T1");
      expect(state.heldBills).toEqual(held);
      expect(state.varianceWarnPaisa).toBe(150);
    });
  });

  describe("requireOpenShift", () => {
    it("throws NoOpenShiftError with no open shift and returns the shift otherwise", () => {
      signIn("cashier");
      expect(() => requireOpenShift(database.db, terminalId())).toThrow(NoOpenShiftError);

      const id = openWith(0);

      expect(requireOpenShift(database.db, terminalId()).id).toBe(id);
    });
  });

  describe("addCashMove", () => {
    it("needs an open shift", () => {
      signIn("cashier");

      expect(service.addCashMove({ kind: "in", amountPaisa: 100, reason: "x" })).toMatchObject({
        ok: false,
        reason: "no-open-shift",
      });
      expect(database.db.select().from(shiftCashMoves).all()).toHaveLength(0);
    });

    it("stores the move with the creator, store and terminal and writes no audit row", () => {
      const user = signIn("cashier");
      const shiftId = openWith(0);

      const result = service.addCashMove({
        kind: "out",
        amountPaisa: 20000,
        reason: "Tea",
      });

      expect(result).toMatchObject({
        ok: true,
        move: {
          kind: "out",
          amountPaisa: 20000,
          reason: "Tea",
          createdBy: { id: user.id, displayName: "cashier name" },
        },
      });
      expect(database.db.select().from(shiftCashMoves).get()).toMatchObject({
        shiftId,
        createdBy: user.id,
        storeId: storeId(),
        terminalId: terminalId(),
      });
      expect(auditRows("cash_move_delete")).toHaveLength(0);
    });

    it("refuses with no session", () => {
      expect(() => service.addCashMove({ kind: "in", amountPaisa: 1, reason: "x" })).toThrow(
        UnauthenticatedError,
      );
    });
  });

  describe("deleteCashMove", () => {
    it("soft-deletes the move and writes one cash_move_delete row", () => {
      const user = signIn("cashier");
      openWith(0);
      const id = addMove("out", 20000, "Tea");

      expect(service.deleteCashMove({ id })).toEqual({ ok: true });

      const row = database.db.select().from(shiftCashMoves).get()!;
      expect(row.deletedAt).not.toBeNull();
      expect(row.deletedBy).toBe(user.id);
      const audit = auditRows("cash_move_delete");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actorUserId: user.id,
        entityType: "shift_cash_move",
        entityId: id,
      });
      expect(JSON.parse(audit[0]!.details!)).toEqual({
        shiftId: row.shiftId,
        kind: "out",
        amountPaisa: 20000,
        reason: "Tea",
      });
    });

    it("returns not-found when deleting twice or for an unknown id", () => {
      signIn("cashier");
      openWith(0);
      const id = addMove("in", 100, "x");
      service.deleteCashMove({ id });

      expect(service.deleteCashMove({ id })).toMatchObject({ ok: false, reason: "not-found" });
      expect(service.deleteCashMove({ id: "0190a000-0000-7000-8000-000000000001" })).toMatchObject({
        ok: false,
        reason: "not-found",
      });
      expect(auditRows("cash_move_delete")).toHaveLength(1);
    });

    it("leaves deleted moves out of the X-report totals and expected cash", () => {
      signIn("cashier");
      const shiftId = openWith(500000);
      addMove("in", 50000, "Change from bank");
      const tea = addMove("out", 20000, "Tea");

      const before = service.report({ id: shiftId });
      expect(before).toMatchObject({
        ok: true,
        report: {
          kind: "x",
          cashIn: { totalPaisa: 50000 },
          cashOut: { totalPaisa: 20000 },
          expectedCashPaisa: 530000,
        },
      });

      service.deleteCashMove({ id: tea });

      const after = service.report({ id: shiftId });
      expect(after).toMatchObject({
        ok: true,
        report: {
          cashOut: { moves: [], totalPaisa: 0 },
          expectedCashPaisa: 550000,
          expectedByMethod: [
            { method: "cash", label: "Cash", expectedPaisa: 550000 },
            { method: "card", label: "Card", expectedPaisa: 0 },
            { method: "bank_transfer", label: "Bank transfer", expectedPaisa: 0 },
            { method: "jazzcash", label: "JazzCash", expectedPaisa: 0 },
            { method: "easypaisa", label: "Easypaisa", expectedPaisa: 0 },
          ],
        },
      });
    });

    it("refuses with no session", () => {
      expect(() => service.deleteCashMove({ id: "x" })).toThrow(UnauthenticatedError);
      expect(() => service.report({ id: "x" })).toThrow(UnauthenticatedError);
    });
  });

  describe("report", () => {
    it("returns not-found for an unknown shift", () => {
      signIn("cashier");

      expect(service.report({ id: "0190a000-0000-7000-8000-000000000001" })).toMatchObject({
        ok: false,
        reason: "not-found",
      });
    });
  });

  describe("listDenominations", () => {
    it("lists the seeded notes and coins, largest first, without deleted ones", () => {
      signIn("cashier");
      database.db
        .update(cashDenominations)
        .set({ deletedAt: new Date() })
        .where(eq(cashDenominations.valuePaisa, 100))
        .run();

      const list = service.listDenominations();

      expect(list).toHaveLength(9);
      expect(list[0]).toMatchObject({ valuePaisa: 500000, kind: "note" });
      expect(list.at(-1)).toMatchObject({ valuePaisa: 200, kind: "coin" });
    });
  });

  describe("close", () => {
    it("by denomination stores the count lines with value snapshots, the figures and one shift_close row", () => {
      const user = signIn("cashier");
      const shiftId = openWith(500000);
      addMove("in", 50000, "Change from bank");
      addMove("out", 20000, "Tea");

      const result = service.close({
        shiftId,
        count: {
          method: "denominations",
          lines: [
            { denominationId: denominationId(100000), count: 5 },
            { denominationId: denominationId(10000), count: 2 },
            { denominationId: denominationId(500), count: 0 },
          ],
        },
        note: "Short a bit",
      });

      expect(result).toMatchObject({
        ok: true,
        report: {
          kind: "z",
          expectedCashPaisa: 530000,
          variancePaisa: -10000,
          note: "Short a bit",
          closedBy: "cashier name",
          count: {
            method: "denominations",
            countedCashPaisa: 520000,
            lines: [
              { valuePaisa: 100000, count: 5, totalPaisa: 500000 },
              { valuePaisa: 10000, count: 2, totalPaisa: 20000 },
            ],
          },
        },
      });
      const row = database.db.select().from(shifts).get()!;
      expect(row).toMatchObject({
        closedBy: user.id,
        countedCashPaisa: 520000,
        expectedCashPaisa: 530000,
        variancePaisa: -10000,
      });
      expect(row.closedAt).not.toBeNull();
      const lines = database.db.select().from(shiftCashCounts).all();
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({
        shiftId,
        storeId: storeId(),
        terminalId: terminalId(),
      });
      const audit = auditRows("shift_close");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actorUserId: user.id, entityId: shiftId });
      expect(JSON.parse(audit[0]!.details!)).toEqual({
        countMethod: "denominations",
        expectedCashPaisa: 530000,
        countedCashPaisa: 520000,
        variancePaisa: -10000,
      });
    });

    it("by total stores no count lines", () => {
      signIn("cashier");
      const shiftId = openWith(1000);

      const result = service.close({
        shiftId,
        count: { method: "total", countedCashPaisa: 1500 },
      });

      expect(result).toMatchObject({
        ok: true,
        report: {
          count: { method: "total", lines: [], countedCashPaisa: 1500 },
          variancePaisa: 500,
          note: null,
        },
      });
      expect(database.db.select().from(shiftCashCounts).all()).toHaveLength(0);
    });

    it("computes expected cash from the database after a delete", () => {
      signIn("cashier");
      const shiftId = openWith(1000);
      addMove("in", 500, "a");
      const out = addMove("out", 300, "b");
      service.deleteCashMove({ id: out });

      service.close({ shiftId, count: { method: "total", countedCashPaisa: 1500 } });

      expect(database.db.select().from(shifts).get()).toMatchObject({
        expectedCashPaisa: 1500,
        variancePaisa: 0,
      });
    });

    it("refuses an unknown or deleted denomination and writes nothing", () => {
      signIn("cashier");
      const shiftId = openWith(0);
      const deleted = denominationId(100);
      database.db
        .update(cashDenominations)
        .set({ deletedAt: new Date() })
        .where(eq(cashDenominations.id, deleted))
        .run();

      for (const id of [deleted, "0190a000-0000-7000-8000-000000000001"]) {
        expect(
          service.close({
            shiftId,
            count: {
              method: "denominations",
              lines: [
                { denominationId: denominationId(1000), count: 1 },
                { denominationId: id, count: 1 },
              ],
            },
          }),
        ).toMatchObject({ ok: false, reason: "unknown-denomination" });
      }
      expect(database.db.select().from(shifts).get()!.closedAt).toBeNull();
      expect(database.db.select().from(shiftCashCounts).all()).toHaveLength(0);
      expect(auditRows("shift_close")).toHaveLength(0);
    });

    it("refuses while held bills exist, returning them, and writes nothing", () => {
      signIn("cashier");
      const shiftId = openWith(0);
      held = [{ id: "b1", label: "Bill 1", totalPaisa: 900, heldAt: new Date(0).toISOString() }];

      const result = service.close({
        shiftId,
        count: { method: "total", countedCashPaisa: 0 },
      });

      expect(result).toMatchObject({ ok: false, reason: "held-bills", bills: held });
      expect(database.db.select().from(shifts).get()!.closedAt).toBeNull();
      expect(auditRows("shift_close")).toHaveLength(0);
    });

    it("returns not-open when closing twice", () => {
      signIn("cashier");
      const shiftId = openWith(0);
      const input = { shiftId, count: { method: "total", countedCashPaisa: 0 } } as const;
      service.close(input);

      expect(service.close(input)).toMatchObject({ ok: false, reason: "not-open" });
      expect(auditRows("shift_close")).toHaveLength(1);
    });

    it("refuses to delete a cash move after close", () => {
      signIn("cashier");
      const shiftId = openWith(0);
      const id = addMove("in", 100, "x");
      service.close({ shiftId, count: { method: "total", countedCashPaisa: 100 } });

      expect(service.deleteCashMove({ id })).toMatchObject({
        ok: false,
        reason: "shift-closed",
      });
      expect(database.db.select().from(shiftCashMoves).get()!.deletedAt).toBeNull();
      expect(auditRows("cash_move_delete")).toHaveLength(0);
    });

    it("builds the Z-report from the stored figures", () => {
      signIn("cashier");
      const shiftId = openWith(1000);
      service.close({ shiftId, count: { method: "total", countedCashPaisa: 900 } });
      database.sqlite.exec("UPDATE shifts SET expected_cash_paisa = 4242, variance_paisa = -3342");

      expect(service.report({ id: shiftId })).toMatchObject({
        ok: true,
        report: { kind: "z", expectedCashPaisa: 4242, variancePaisa: -3342 },
      });
    });

    it("lets a new shift open after close", () => {
      signIn("cashier");
      const shiftId = openWith(0);
      service.close({ shiftId, count: { method: "total", countedCashPaisa: 250 } });

      expect(service.state()).toEqual({ status: "closed", suggestedFloatPaisa: 250 });
      expect(service.open({ openingFloatPaisa: 250 }).ok).toBe(true);
    });

    it("refuses with no session", () => {
      expect(() =>
        service.close({
          shiftId: "0190a000-0000-7000-8000-000000000001",
          count: { method: "total", countedCashPaisa: 0 },
        }),
      ).toThrow(UnauthenticatedError);
    });
  });
});

function draftOf(result: BillResult) {
  if (!result.ok) throw new Error("add failed");
  return result.bill;
}

describe("shift sales", () => {
  let kit: CheckoutKit;
  let salesService: ReturnType<typeof createSalesService>;

  beforeEach(() => {
    kit = createCheckoutKit();
    kit.signIn("cashier");
    salesService = createSalesService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      stock: createStockService({ database: kit.database, audit: kit.audit }),
    });
  });

  afterEach(() => kit.close());

  const sell = (
    productId: string,
    payments: CompleteSaleInput["payments"],
    options: { qtyMilli?: number; isReturn?: boolean } = {},
  ) => {
    const bill = draftOf(kit.billDrafts.addProduct({ productId, ...options }));
    const result = salesService.complete({ draftId: bill.id, payments });
    if (!result.ok) throw new Error(`sale refused: ${result.reason}`);
    return result.sale;
  };
  const report = (shiftId: string) => {
    const result = kit.shifts.report({ id: shiftId });
    if (!result.ok) throw new Error("report failed");
    return result.report;
  };
  const expected = (shiftId: string) =>
    Object.fromEntries(
      report(shiftId).expectedByMethod.map((row) => [row.method, row.expectedPaisa]),
    );

  it("adds a cash sale to expected cash and lists every method", () => {
    const shiftId = kit.openShift(500000);
    const tea = kit.addProduct({ salePricePaisa: 45000 });

    sell(tea.id, [{ method: "cash", amountPaisa: 50000 }]);

    expect(report(shiftId).expectedByMethod.map((row) => row.method)).toEqual([
      "cash",
      "card",
      "bank_transfer",
      "jazzcash",
      "easypaisa",
    ]);
    expect(expected(shiftId)).toEqual({
      cash: 545000,
      card: 0,
      bank_transfer: 0,
      jazzcash: 0,
      easypaisa: 0,
    });
    expect(report(shiftId).expectedCashPaisa).toBe(545000);
  });

  it("takes change out of the till after a card overpay", () => {
    const shiftId = kit.openShift(500000);
    const oil = kit.addProduct({ salePricePaisa: 98000 });

    sell(oil.id, [{ method: "card", amountPaisa: 100000, reference: "4821" }]);

    expect(expected(shiftId)).toMatchObject({ cash: 498000, card: 100000 });
  });

  it("takes a cash refund out of the till", () => {
    const shiftId = kit.openShift(500000);
    const soap = kit.addProduct({ salePricePaisa: 5000 });

    sell(soap.id, [{ method: "cash", amountPaisa: 5000 }]);
    sell(soap.id, [{ method: "cash", amountPaisa: 5000 }], { isReturn: true });

    expect(expected(shiftId).cash).toBe(500000);
    expect(report(shiftId).refunds).toEqual({ count: 1, amountPaisa: 5000 });
    expect(report(shiftId).sales).toMatchObject({ billCount: 2, refundBillCount: 1 });
  });

  it("adds up the X sections to the sales of the shift", () => {
    const shiftId = kit.openShift(0);
    const tea = kit.addProduct({ salePricePaisa: 11800 });
    const rice = kit.addProduct({
      nameEn: "Rice",
      searchText: "rice",
      salePricePaisa: 5000,
      taxCategoryId: kit.taxCategoryId("Exempt"),
    });

    const discounted = draftOf(kit.billDrafts.addProduct({ productId: tea.id, qtyMilli: 2000 }));
    kit.billDrafts.setBillDiscount({
      draftId: discounted.id,
      discount: { kind: "percent", bps: 1000 },
    });
    const first = salesService.complete({
      draftId: discounted.id,
      payments: [
        { method: "card", amountPaisa: 10000 },
        { method: "jazzcash", amountPaisa: 11240 },
      ],
    });
    expect(first.ok).toBe(true);
    sell(rice.id, [{ method: "cash", amountPaisa: 6000 }]);
    sell(rice.id, [{ method: "cash", amountPaisa: 5000 }], { isReturn: true });

    const lined = draftOf(kit.billDrafts.addProduct({ productId: tea.id }));
    const second = draftOf(kit.billDrafts.addProduct({ productId: rice.id }));
    kit.billDrafts.deleteLine({ lineId: second.lines[1]!.id });
    kit.billDrafts.discard({ draftId: lined.id });

    const summary = report(shiftId);
    const rows = kit.database.db.select().from(sales).all();
    const sumOf = (pick: (row: (typeof rows)[number]) => number) =>
      rows.reduce((acc, row) => acc + pick(row), 0);

    expect(summary.sales.totalPaisa).toBe(sumOf((row) => row.totalPaisa));
    expect(summary.sales.byMethod.reduce((acc, row) => acc + row.amountPaisa, 0)).toBe(
      summary.sales.totalPaisa,
    );
    expect(summary.taxes.reduce((acc, row) => acc + row.taxPaisa, 0)).toBe(
      sumOf((row) => row.taxPaisa),
    );
    expect(summary.taxes.map((row) => row.rateBps)).toEqual([1800, 0]);
    expect(summary.discounts).toEqual({
      count: 1,
      amountPaisa: sumOf((row) => row.discountPaisa),
    });
    expect(summary.refunds).toEqual({ count: 1, amountPaisa: 5000 });
    expect(summary.deletedLines).toEqual({ count: 1 });
    expect(summary.discardedBills).toEqual({ count: 1 });
    expect(summary.sales).toMatchObject({ billCount: 3, refundBillCount: 1 });
  });

  it("keeps the stored expected cash on the Z report", () => {
    const shiftId = kit.openShift(100000);
    const tea = kit.addProduct({ salePricePaisa: 10000 });
    sell(tea.id, [{ method: "cash", amountPaisa: 10000 }]);

    const closed = kit.shifts.close({
      shiftId,
      count: { method: "total", countedCashPaisa: 110000 },
    });

    expect(closed).toMatchObject({ ok: true });
    if (!closed.ok) return;
    expect(closed.report).toMatchObject({
      kind: "z",
      expectedCashPaisa: 110000,
      variancePaisa: 0,
    });
    expect(closed.report.sales.totalPaisa).toBe(10000);
  });

  it("refuses to close while a non-empty draft exists, then closes once it is discarded", () => {
    const shiftId = kit.openShift(0);
    const tea = kit.addProduct();
    const bill = draftOf(kit.billDrafts.addProduct({ productId: tea.id }));
    const input = { shiftId, count: { method: "total", countedCashPaisa: 0 } } as const;

    const refused = kit.shifts.close(input);
    expect(refused).toMatchObject({ ok: false, reason: "held-bills" });
    if (refused.ok || refused.reason !== "held-bills") return;
    expect(refused.bills.map((row) => row.id)).toEqual([bill.id]);

    kit.billDrafts.discard({ draftId: bill.id });
    expect(kit.shifts.close(input)).toMatchObject({ ok: true });
  });
});
