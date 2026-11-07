import { and, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  hourLabel,
  storeDayBounds,
  storeDayOfBucket,
  storeUtcOffsetMs,
  type ReportRange,
  type SalesByDayResult,
  type SalesByDayRow,
  type SalesByHourResult,
  type SalesByHourRow,
  type SalesByPeriodTotals,
} from "../../shared/reports";
import type { VendoraDatabase } from "../db/client";
import { saleLines, sales } from "../db/schema";

const dayMs = 24 * 60 * 60 * 1000;

export const saleDayBucket = sql<number>`(${sales.createdAt} + ${sql.raw(String(storeUtcOffsetMs))}) / ${sql.raw(String(dayMs))}`;

export function saleWindow(storeId: string, range: ReportRange): SQL {
  const { start, end } = storeDayBounds(range);
  return and(
    eq(sales.storeId, storeId),
    gte(sales.createdAt, start),
    lt(sales.createdAt, end),
  ) as SQL;
}

const sumOf = (column: AnySQLiteColumn) => sql<number>`coalesce(sum(${column}), 0)`;

const hourMs = 60 * 60 * 1000;

const saleHourBucket = sql<number>`((${sales.createdAt} + ${sql.raw(String(storeUtcOffsetMs))}) / ${sql.raw(String(hourMs))}) % 24`;

const emptyTotals = (): SalesByPeriodTotals => ({
  billCount: 0,
  grossPaisa: 0,
  returnsPaisa: 0,
  discountPaisa: 0,
  netPaisa: 0,
  taxPaisa: 0,
  roundingPaisa: 0,
  totalPaisa: 0,
});

const addTotals = (sum: SalesByPeriodTotals, row: SalesByPeriodTotals): SalesByPeriodTotals => {
  const next = { ...sum };
  for (const key of Object.keys(next) as (keyof SalesByPeriodTotals)[]) next[key] += row[key];
  return next;
};

function readSalesByPeriod(
  database: VendoraDatabase,
  storeId: string,
  range: ReportRange,
  bucket: SQL<number>,
): { bucket: number; row: SalesByPeriodTotals }[] {
  const where = saleWindow(storeId, range);

  const bills = database.db
    .select({
      bucket,
      billCount: sql<number>`count(*)`,
      discountPaisa: sumOf(sales.discountPaisa),
      taxPaisa: sumOf(sales.taxPaisa),
      roundingPaisa: sumOf(sales.roundingPaisa),
      totalPaisa: sumOf(sales.totalPaisa),
    })
    .from(sales)
    .where(where)
    .groupBy(bucket)
    .all();

  const lines = database.db
    .select({
      bucket,
      grossPaisa: sql<number>`coalesce(sum(case when ${saleLines.isReturn} = 0 then ${saleLines.totalPaisa} - ${saleLines.taxPaisa} else 0 end), 0)`,
      returnsPaisa: sql<number>`coalesce(sum(case when ${saleLines.isReturn} = 1 then ${saleLines.taxPaisa} - ${saleLines.totalPaisa} else 0 end), 0)`,
    })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .where(where)
    .groupBy(bucket)
    .all();
  const lineByBucket = new Map(lines.map((line) => [line.bucket, line]));

  return bills
    .toSorted((a, b) => a.bucket - b.bucket)
    .map(({ bucket: key, ...bill }) => ({
      bucket: key,
      row: {
        ...bill,
        grossPaisa: lineByBucket.get(key)?.grossPaisa ?? 0,
        returnsPaisa: lineByBucket.get(key)?.returnsPaisa ?? 0,
        netPaisa: bill.totalPaisa - bill.taxPaisa - bill.roundingPaisa,
      },
    }));
}

export function readSalesByDay(
  database: VendoraDatabase,
  storeId: string,
  range: ReportRange,
): SalesByDayResult {
  const periods = readSalesByPeriod(database, storeId, range, saleDayBucket);
  const rows: SalesByDayRow[] = periods.map(({ bucket, row }) => ({
    day: storeDayOfBucket(bucket),
    ...row,
  }));
  return { rows, totals: rows.reduce(addTotals, emptyTotals()) };
}

export function readSalesByHour(
  database: VendoraDatabase,
  storeId: string,
  range: ReportRange,
): SalesByHourResult {
  const periods = readSalesByPeriod(database, storeId, range, saleHourBucket);
  if (periods.length === 0) return { rows: [], totals: emptyTotals() };
  const byHour = new Map(periods.map(({ bucket, row }) => [bucket, row]));
  const rows: SalesByHourRow[] = Array.from({ length: 24 }, (_, hour) => ({
    hour: hourLabel(hour),
    ...(byHour.get(hour) ?? emptyTotals()),
  }));
  return { rows, totals: rows.reduce(addTotals, emptyTotals()) };
}
