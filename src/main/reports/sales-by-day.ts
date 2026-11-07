import { and, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  storeDayBounds,
  storeDayOfBucket,
  storeUtcOffsetMs,
  type ReportRange,
  type SalesByDayResult,
  type SalesByDayRow,
  type SalesByDayTotals,
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

const quantityOf = (unit: "piece" | "kg" | "litre") =>
  sql<number>`coalesce(sum(case when ${saleLines.unit} = ${unit} then ${saleLines.qtyMilli} else 0 end), 0)`;

const sumOf = (column: AnySQLiteColumn) => sql<number>`coalesce(sum(${column}), 0)`;

const emptyTotals = (): SalesByDayTotals => ({
  billCount: 0,
  pieceQtyMilli: 0,
  kgQtyMilli: 0,
  litreQtyMilli: 0,
  discountPaisa: 0,
  netPaisa: 0,
  taxPaisa: 0,
  roundingPaisa: 0,
  totalPaisa: 0,
});

export function readSalesByDay(
  database: VendoraDatabase,
  storeId: string,
  range: ReportRange,
): SalesByDayResult {
  const where = saleWindow(storeId, range);

  const bills = database.db
    .select({
      bucket: saleDayBucket,
      billCount: sql<number>`count(*)`,
      discountPaisa: sumOf(sales.discountPaisa),
      taxPaisa: sumOf(sales.taxPaisa),
      roundingPaisa: sumOf(sales.roundingPaisa),
      totalPaisa: sumOf(sales.totalPaisa),
    })
    .from(sales)
    .where(where)
    .groupBy(saleDayBucket)
    .all();

  const quantities = database.db
    .select({
      bucket: saleDayBucket,
      pieceQtyMilli: quantityOf("piece"),
      kgQtyMilli: quantityOf("kg"),
      litreQtyMilli: quantityOf("litre"),
    })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .where(where)
    .groupBy(saleDayBucket)
    .all();
  const quantityByBucket = new Map(quantities.map((row) => [row.bucket, row]));

  const rows: SalesByDayRow[] = bills
    .toSorted((a, b) => a.bucket - b.bucket)
    .map(({ bucket, ...bill }) => {
      const quantity = quantityByBucket.get(bucket);
      return {
        day: storeDayOfBucket(bucket),
        ...bill,
        pieceQtyMilli: quantity?.pieceQtyMilli ?? 0,
        kgQtyMilli: quantity?.kgQtyMilli ?? 0,
        litreQtyMilli: quantity?.litreQtyMilli ?? 0,
        netPaisa: bill.totalPaisa - bill.taxPaisa - bill.roundingPaisa,
      };
    });

  const totals = rows.reduce<SalesByDayTotals>((sum, row) => {
    const next = { ...sum };
    for (const key of Object.keys(next) as (keyof SalesByDayTotals)[]) next[key] += row[key];
    return next;
  }, emptyTotals());

  return { rows, totals };
}
