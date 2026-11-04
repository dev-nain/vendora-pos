import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  denominationTotalPaisa,
  expectedCashPaisa,
  shiftMessages,
  sumPaisa,
  variancePaisa,
  type AddCashMoveInput,
  type AddCashMoveResult,
  type CashMove,
  type CloseShiftInput,
  type CloseShiftResult,
  type DeleteCashMoveResult,
  type Denomination,
  type HeldBillSummary,
  type OpenShiftResult,
  type ShiftReport,
  type ShiftReportResult,
  type ShiftState,
} from "../../shared/shifts";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import {
  cashDenominations,
  shiftCashCounts,
  shiftCashMoves,
  shifts,
  terminals,
  users,
} from "../db/schema";
import { isUniqueViolation } from "../db/sqlite-errors";
import { currentTerminal, type DbExecutor } from "../db/terminal";
import { getShiftVarianceWarnPaisa } from "../settings/store-settings";
import type { createAuditService } from "./audit";

type ShiftRow = typeof shifts.$inferSelect;

export class NoOpenShiftError extends Error {
  readonly code = "no-open-shift";

  constructor() {
    super("No shift is open");
    this.name = "NoOpenShiftError";
  }
}

interface ShiftsDeps {
  database: VendoraDatabase;
  audit: ReturnType<typeof createAuditService>;
  sessions: SessionStore;
  heldBills: (shiftId: string) => HeldBillSummary[];
  now?: () => Date;
}

const alreadyOpen = {
  ok: false,
  reason: "already-open",
  message: shiftMessages.alreadyOpen,
} as const;

const noOpenShift = {
  ok: false,
  reason: "no-open-shift",
  message: shiftMessages.noOpenShift,
} as const;

const notFound = { ok: false, reason: "not-found", message: shiftMessages.notFound } as const;

const shiftClosed = {
  ok: false,
  reason: "shift-closed",
  message: shiftMessages.shiftClosed,
} as const;

const notOpen = { ok: false, reason: "not-open", message: shiftMessages.notOpen } as const;

const unknownDenomination = {
  ok: false,
  reason: "unknown-denomination",
  message: shiftMessages.unknownDenomination,
} as const;

export function requireOpenShift(executor: DbExecutor, terminalId: string): ShiftRow {
  const shift = executor
    .select()
    .from(shifts)
    .where(and(eq(shifts.terminalId, terminalId), isNull(shifts.closedAt)))
    .get();
  if (!shift) throw new NoOpenShiftError();
  return shift;
}

function findOpenShift(executor: DbExecutor, terminalId: string): ShiftRow | undefined {
  return executor
    .select()
    .from(shifts)
    .where(and(eq(shifts.terminalId, terminalId), isNull(shifts.closedAt)))
    .get();
}

function displayNameOf(executor: DbExecutor, userId: string): string {
  const row = executor
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return row?.displayName ?? "";
}

function movesOf(executor: DbExecutor, shiftId: string, kind: "in" | "out"): CashMove[] {
  return executor
    .select({
      id: shiftCashMoves.id,
      kind: shiftCashMoves.kind,
      amountPaisa: shiftCashMoves.amountPaisa,
      reason: shiftCashMoves.reason,
      createdById: users.id,
      createdByName: users.displayName,
      createdAt: shiftCashMoves.createdAt,
    })
    .from(shiftCashMoves)
    .innerJoin(users, eq(users.id, shiftCashMoves.createdBy))
    .where(
      and(
        eq(shiftCashMoves.shiftId, shiftId),
        eq(shiftCashMoves.kind, kind),
        isNull(shiftCashMoves.deletedAt),
      ),
    )
    .orderBy(asc(shiftCashMoves.createdAt), asc(shiftCashMoves.id))
    .all()
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      amountPaisa: row.amountPaisa,
      reason: row.reason,
      createdBy: { id: row.createdById, displayName: row.createdByName },
      createdAt: row.createdAt.toISOString(),
    }));
}

function buildReport(executor: DbExecutor, shift: ShiftRow, kind: "x" | "z"): ShiftReport {
  const cashIn = movesOf(executor, shift.id, "in");
  const cashOut = movesOf(executor, shift.id, "out");
  const cashInPaisa = sumPaisa(cashIn.map((move) => move.amountPaisa));
  const cashOutPaisa = sumPaisa(cashOut.map((move) => move.amountPaisa));
  const terminal = executor
    .select({ code: terminals.code })
    .from(terminals)
    .where(eq(terminals.id, shift.terminalId))
    .get();

  const closed = kind === "z" && shift.closedAt !== null;
  const expectedPaisa = closed
    ? (shift.expectedCashPaisa ?? 0)
    : expectedCashPaisa({
        openingFloatPaisa: shift.openingFloatPaisa,
        cashInPaisa,
        cashOutPaisa,
      });

  let count: ShiftReport["count"] = null;
  if (closed) {
    const lines = executor
      .select({ valuePaisa: shiftCashCounts.valuePaisa, count: shiftCashCounts.count })
      .from(shiftCashCounts)
      .where(eq(shiftCashCounts.shiftId, shift.id))
      .orderBy(desc(shiftCashCounts.valuePaisa))
      .all()
      .map((line) => ({
        ...line,
        totalPaisa: denominationTotalPaisa([line]),
      }));
    count = {
      method: lines.length > 0 ? "denominations" : "total",
      lines,
      countedCashPaisa: shift.countedCashPaisa ?? 0,
    };
  }

  return {
    kind,
    shiftId: shift.id,
    terminalCode: terminal?.code ?? "",
    openedBy: displayNameOf(executor, shift.openedBy),
    openedAt: shift.openedAt.toISOString(),
    closedBy: shift.closedBy ? displayNameOf(executor, shift.closedBy) : null,
    closedAt: shift.closedAt ? shift.closedAt.toISOString() : null,
    openingFloatPaisa: shift.openingFloatPaisa,
    cashIn: { moves: cashIn, totalPaisa: cashInPaisa },
    cashOut: { moves: cashOut, totalPaisa: cashOutPaisa },
    expectedByMethod: [{ method: "cash", label: "Cash", expectedPaisa }],
    expectedCashPaisa: expectedPaisa,
    count,
    variancePaisa: closed ? shift.variancePaisa : null,
    note: closed ? shift.note : null,
  };
}

function suggestedFloat(executor: DbExecutor, terminalId: string): number {
  const last = executor
    .select({ countedCashPaisa: shifts.countedCashPaisa })
    .from(shifts)
    .where(and(eq(shifts.terminalId, terminalId), isNotNull(shifts.closedAt)))
    .orderBy(desc(shifts.closedAt))
    .limit(1)
    .get();
  return last?.countedCashPaisa ?? 0;
}

export function createShiftsService({
  database,
  audit,
  sessions,
  heldBills,
  now = () => new Date(),
}: ShiftsDeps) {
  const { db } = database;

  function state(): ShiftState {
    const session = requireSession(sessions);
    return db.transaction((tx) => {
      const terminal = currentTerminal(tx);
      const shift = findOpenShift(tx, terminal.id);
      if (!shift) return { status: "closed", suggestedFloatPaisa: suggestedFloat(tx, terminal.id) };
      return {
        status: "open",
        shift: {
          id: shift.id,
          openedAt: shift.openedAt.toISOString(),
          openedBy: displayNameOf(tx, shift.openedBy),
        },
        report: buildReport(tx, shift, "x"),
        heldBills: heldBills(shift.id),
        varianceWarnPaisa: getShiftVarianceWarnPaisa(database, session.storeId),
      };
    });
  }

  function open(input: { openingFloatPaisa: number }): OpenShiftResult {
    const session = requireSession(sessions);
    try {
      return db.transaction((tx) => {
        const terminal = currentTerminal(tx);
        if (findOpenShift(tx, terminal.id)) return alreadyOpen;
        const openedAt = now();
        const shift = tx
          .insert(shifts)
          .values({
            storeId: terminal.storeId,
            terminalId: terminal.id,
            openedBy: session.userId,
            openedAt,
            openingFloatPaisa: input.openingFloatPaisa,
          })
          .returning()
          .get();
        audit.record(
          {
            action: "shift_open",
            actorUserId: session.userId,
            entityType: "shift",
            entityId: shift.id,
            details: { openingFloatPaisa: input.openingFloatPaisa },
          },
          tx,
        );
        return {
          ok: true,
          shift: {
            id: shift.id,
            openedAt: openedAt.toISOString(),
            openedBy: displayNameOf(tx, session.userId),
          },
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) return alreadyOpen;
      throw error;
    }
  }

  function addCashMove(input: AddCashMoveInput): AddCashMoveResult {
    const session = requireSession(sessions);
    return db.transaction((tx) => {
      const terminal = currentTerminal(tx);
      let shift: ShiftRow;
      try {
        shift = requireOpenShift(tx, terminal.id);
      } catch (error) {
        if (error instanceof NoOpenShiftError) return noOpenShift;
        throw error;
      }
      const createdAt = now();
      const move = tx
        .insert(shiftCashMoves)
        .values({
          storeId: terminal.storeId,
          terminalId: terminal.id,
          shiftId: shift.id,
          kind: input.kind,
          amountPaisa: input.amountPaisa,
          reason: input.reason,
          createdBy: session.userId,
          createdAt,
        })
        .returning()
        .get();
      return {
        ok: true,
        move: {
          id: move.id,
          kind: move.kind,
          amountPaisa: move.amountPaisa,
          reason: move.reason,
          createdBy: {
            id: session.userId,
            displayName: displayNameOf(tx, session.userId),
          },
          createdAt: createdAt.toISOString(),
        },
      };
    });
  }

  function deleteCashMove({ id }: { id: string }): DeleteCashMoveResult {
    const session = requireSession(sessions);
    return db.transaction((tx) => {
      const row = tx
        .select({
          move: shiftCashMoves,
          shiftClosedAt: shifts.closedAt,
        })
        .from(shiftCashMoves)
        .innerJoin(shifts, eq(shifts.id, shiftCashMoves.shiftId))
        .where(and(eq(shiftCashMoves.id, id), isNull(shiftCashMoves.deletedAt)))
        .get();
      if (!row) return notFound;
      if (row.shiftClosedAt) return shiftClosed;

      tx.update(shiftCashMoves)
        .set({ deletedAt: now(), deletedBy: session.userId })
        .where(and(eq(shiftCashMoves.id, id), isNull(shiftCashMoves.deletedAt)))
        .run();
      audit.record(
        {
          action: "cash_move_delete",
          actorUserId: session.userId,
          entityType: "shift_cash_move",
          entityId: id,
          details: {
            shiftId: row.move.shiftId,
            kind: row.move.kind,
            amountPaisa: row.move.amountPaisa,
            reason: row.move.reason,
          },
        },
        tx,
      );
      return { ok: true };
    });
  }

  function report({ id }: { id: string }): ShiftReportResult {
    const session = requireSession(sessions);
    return db.transaction((tx) => {
      const shift = tx
        .select()
        .from(shifts)
        .where(and(eq(shifts.id, id), eq(shifts.storeId, session.storeId)))
        .get();
      if (!shift) return notFound;
      return { ok: true, report: buildReport(tx, shift, shift.closedAt ? "z" : "x") };
    });
  }

  function listDenominations(): Denomination[] {
    const session = requireSession(sessions);
    return db
      .select({
        id: cashDenominations.id,
        valuePaisa: cashDenominations.valuePaisa,
        kind: cashDenominations.kind,
      })
      .from(cashDenominations)
      .where(
        and(eq(cashDenominations.storeId, session.storeId), isNull(cashDenominations.deletedAt)),
      )
      .orderBy(desc(cashDenominations.valuePaisa))
      .all();
  }

  function close(input: CloseShiftInput): CloseShiftResult {
    const session = requireSession(sessions);
    return db.transaction((tx) => {
      const shift = tx.select().from(shifts).where(eq(shifts.id, input.shiftId)).get();
      if (!shift || shift.closedAt) return notOpen;

      const bills = heldBills(shift.id);
      if (bills.length > 0) {
        return {
          ok: false,
          reason: "held-bills",
          message: shiftMessages.heldBills,
          bills,
        };
      }

      let countedPaisa: number;
      const countLines: { denominationId: string; valuePaisa: number; count: number }[] = [];
      if (input.count.method === "denominations") {
        const ids = input.count.lines.map((line) => line.denominationId);
        const found =
          ids.length === 0
            ? []
            : tx
                .select({ id: cashDenominations.id, valuePaisa: cashDenominations.valuePaisa })
                .from(cashDenominations)
                .where(
                  and(
                    inArray(cashDenominations.id, ids),
                    eq(cashDenominations.storeId, shift.storeId),
                    isNull(cashDenominations.deletedAt),
                  ),
                )
                .all();
        if (found.length !== ids.length) return unknownDenomination;
        const valueById = new Map(found.map((row) => [row.id, row.valuePaisa]));
        for (const line of input.count.lines) {
          if (line.count === 0) continue;
          countLines.push({
            denominationId: line.denominationId,
            valuePaisa: valueById.get(line.denominationId) ?? 0,
            count: line.count,
          });
        }
        countedPaisa = denominationTotalPaisa(countLines);
      } else {
        countedPaisa = input.count.countedCashPaisa;
      }

      const cashInPaisa = sumPaisa(movesOf(tx, shift.id, "in").map((move) => move.amountPaisa));
      const cashOutPaisa = sumPaisa(movesOf(tx, shift.id, "out").map((move) => move.amountPaisa));
      const expectedPaisa = expectedCashPaisa({
        openingFloatPaisa: shift.openingFloatPaisa,
        cashInPaisa,
        cashOutPaisa,
      });
      const variance = variancePaisa(countedPaisa, expectedPaisa);

      const closedAt = now();
      const updated = tx
        .update(shifts)
        .set({
          closedAt,
          closedBy: session.userId,
          countedCashPaisa: countedPaisa,
          expectedCashPaisa: expectedPaisa,
          variancePaisa: variance,
          note: input.note ? input.note : null,
        })
        .where(and(eq(shifts.id, shift.id), isNull(shifts.closedAt)))
        .run();
      if (updated.changes === 0) return notOpen;

      if (countLines.length > 0) {
        tx.insert(shiftCashCounts)
          .values(
            countLines.map((line) => ({
              storeId: shift.storeId,
              terminalId: shift.terminalId,
              shiftId: shift.id,
              ...line,
            })),
          )
          .run();
      }
      audit.record(
        {
          action: "shift_close",
          actorUserId: session.userId,
          entityType: "shift",
          entityId: shift.id,
          details: {
            countMethod: input.count.method,
            expectedCashPaisa: expectedPaisa,
            countedCashPaisa: countedPaisa,
            variancePaisa: variance,
          },
        },
        tx,
      );

      const closedShift = tx.select().from(shifts).where(eq(shifts.id, shift.id)).get() ?? shift;
      return { ok: true, report: buildReport(tx, closedShift, "z") };
    });
  }

  return { state, open, addCashMove, deleteCashMove, report, listDenominations, close };
}

export type ShiftsService = ReturnType<typeof createShiftsService>;
