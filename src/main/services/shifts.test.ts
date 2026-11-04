import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HeldBillSummary } from "../../shared/shifts";
import { UnauthenticatedError } from "../auth/errors";
import { createSessionStore, type SessionStore } from "../auth/session";
import { openDatabase, type VendoraDatabase } from "../db/client";
import { runMigrations } from "../db/migrate";
import {
  auditLog,
  cashDenominations,
  shiftCashMoves,
  shifts,
  stores,
  terminals,
  users,
} from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { createAuditService } from "./audit";
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
      database.db
        .update(shifts)
        .set({ closedAt: new Date(), closedBy: signIn("cashier").id, countedCashPaisa: 7777 })
        .where(eq(shifts.id, id))
        .run();

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
          expectedByMethod: [{ method: "cash", label: "Cash", expectedPaisa: 550000 }],
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
});
