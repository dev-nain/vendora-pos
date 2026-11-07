import { and, desc, eq, gte, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { paymentMethodLabels, paymentMethods } from "../../shared/checkout";
import {
  storeDayBounds,
  type PaymentMethodRow,
  type PaymentMethodsQuery,
  type PaymentMethodsResult,
  type ReportRange,
  type ReportShift,
} from "../../shared/reports";
import type { VendoraDatabase } from "../db/client";
import { salePayments, sales, shifts, users } from "../db/schema";
import { saleWindow } from "./sales-by-day";

const emptyResult = (): PaymentMethodsResult => ({
  rows: [],
  totals: { receivedPaisa: 0, refundedPaisa: 0, netPaisa: 0 },
});

const scopeOf = (storeId: string, query: PaymentMethodsQuery): SQL =>
  "shiftId" in query
    ? (and(eq(sales.storeId, storeId), eq(sales.shiftId, query.shiftId)) as SQL)
    : saleWindow(storeId, query.range);

export function readPaymentMethods(
  database: VendoraDatabase,
  storeId: string,
  query: PaymentMethodsQuery,
): PaymentMethodsResult {
  const grouped = database.db
    .select({
      method: salePayments.method,
      paymentCount: sql<number>`count(*)`,
      receivedPaisa: sql<number>`coalesce(sum(case when ${salePayments.amountPaisa} > 0 or ${salePayments.isChange} = 1 then ${salePayments.amountPaisa} else 0 end), 0)`,
      refundedPaisa: sql<number>`coalesce(-sum(case when ${salePayments.amountPaisa} < 0 and ${salePayments.isChange} = 0 then ${salePayments.amountPaisa} else 0 end), 0)`,
    })
    .from(salePayments)
    .innerJoin(sales, eq(sales.id, salePayments.saleId))
    .where(scopeOf(storeId, query))
    .groupBy(salePayments.method)
    .all();
  if (grouped.length === 0) return emptyResult();

  const byMethod = new Map(grouped.map((row) => [row.method, row]));
  const rows: PaymentMethodRow[] = paymentMethods.map((method) => {
    const row = byMethod.get(method);
    const receivedPaisa = row?.receivedPaisa ?? 0;
    const refundedPaisa = row?.refundedPaisa ?? 0;
    return {
      method: paymentMethodLabels[method],
      receivedPaisa,
      refundedPaisa,
      netPaisa: receivedPaisa - refundedPaisa,
    };
  });
  return {
    rows,
    totals: {
      receivedPaisa: rows.reduce((sum, row) => sum + row.receivedPaisa, 0),
      refundedPaisa: rows.reduce((sum, row) => sum + row.refundedPaisa, 0),
      netPaisa: rows.reduce((sum, row) => sum + row.netPaisa, 0),
    },
  };
}

const shiftColumns = {
  id: shifts.id,
  openedAt: shifts.openedAt,
  closedAt: shifts.closedAt,
  openedBy: users.displayName,
};

const toReportShift = (row: {
  id: string;
  openedAt: Date;
  closedAt: Date | null;
  openedBy: string;
}): ReportShift => ({
  id: row.id,
  openedAt: row.openedAt.toISOString(),
  closedAt: row.closedAt?.toISOString() ?? null,
  openedBy: row.openedBy,
});

export function listReportShifts(
  database: VendoraDatabase,
  storeId: string,
  range: ReportRange,
): ReportShift[] {
  const { start, end } = storeDayBounds(range);
  return database.db
    .select(shiftColumns)
    .from(shifts)
    .innerJoin(users, eq(users.id, shifts.openedBy))
    .where(
      and(
        eq(shifts.storeId, storeId),
        lt(shifts.openedAt, end),
        or(isNull(shifts.closedAt), gte(shifts.closedAt, start)),
      ),
    )
    .orderBy(desc(shifts.openedAt), desc(shifts.id))
    .all()
    .map(toReportShift);
}

export function findReportShift(
  database: VendoraDatabase,
  storeId: string,
  shiftId: string,
): ReportShift | null {
  const row = database.db
    .select(shiftColumns)
    .from(shifts)
    .innerJoin(users, eq(users.id, shifts.openedBy))
    .where(and(eq(shifts.storeId, storeId), eq(shifts.id, shiftId)))
    .get();
  return row ? toReportShift(row) : null;
}
