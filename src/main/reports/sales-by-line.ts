import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  miscItemsLabel,
  noCategoryLabel,
  roundingRowLabel,
  type ReportFooterRow,
  type ReportRange,
  type SalesByCashierResult,
  type SalesByCategoryResult,
  type SalesByLineTotals,
  type SalesByProductResult,
} from "../../shared/reports";
import type { VendoraDatabase } from "../db/client";
import { products, saleLines, sales, users } from "../db/schema";
import { saleWindow } from "./sales-by-day";
import { halfUpDiv } from "./sql-rounding";

type Unit = "piece" | "kg" | "litre";

const lineNet = sql`${saleLines.totalPaisa} - ${saleLines.taxPaisa}`;

const grossOf = sql<number>`coalesce(sum(case when ${saleLines.isReturn} = 0 then ${lineNet} else 0 end), 0)`;
const returnsOf = sql<number>`coalesce(sum(case when ${saleLines.isReturn} = 1 then -(${lineNet}) else 0 end), 0)`;

const baseQty = halfUpDiv(sql`${saleLines.qtyMilli} * ${saleLines.packQtyMilli}`, 1000);
const quantityOf = (unit: Unit) =>
  sql<number>`coalesce(sum(case when ${saleLines.unit} = ${unit} then ${baseQty} else 0 end), 0)`;

function sumTotals<K extends string>(
  rows: readonly { [P in K]: number }[],
  keys: readonly K[],
): Record<K, number> {
  const totals = Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
  for (const row of rows) for (const key of keys) totals[key] += row[key];
  return totals;
}

const lineKeys = [
  "pieceQtyMilli",
  "kgQtyMilli",
  "litreQtyMilli",
  "grossPaisa",
  "returnsPaisa",
  "netPaisa",
] as const;

const lineValues = (row: SalesByLineTotals): SalesByLineTotals => ({
  pieceQtyMilli: row.pieceQtyMilli,
  kgQtyMilli: row.kgQtyMilli,
  litreQtyMilli: row.litreQtyMilli,
  grossPaisa: row.grossPaisa,
  returnsPaisa: row.returnsPaisa,
  netPaisa: row.netPaisa,
});

function roundingFooter(
  database: VendoraDatabase,
  storeId: string,
  range: ReportRange,
): ReportFooterRow[] {
  const row = database.db
    .select({ rounding: sql<number>`coalesce(sum(${sales.roundingPaisa}), 0)` })
    .from(sales)
    .where(saleWindow(storeId, range))
    .get();
  const rounding = row?.rounding ?? 0;
  return rounding === 0 ? [] : [{ label: roundingRowLabel, values: { netPaisa: rounding } }];
}

function miscProductId(database: VendoraDatabase, storeId: string): string | null {
  const row = database.db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.isSystem, true)))
    .get();
  return row?.id ?? null;
}

interface GroupRow extends SalesByLineTotals {
  key: string;
  label: string | null;
}

function readGroups(
  database: VendoraDatabase,
  storeId: string,
  range: ReportRange,
  key: SQL<string>,
  label: SQL<string | null>,
): GroupRow[] {
  return database.db
    .select({
      key,
      label,
      latest: sql<number>`max(${saleLines.createdAt})`,
      pieceQtyMilli: quantityOf("piece"),
      kgQtyMilli: quantityOf("kg"),
      litreQtyMilli: quantityOf("litre"),
      grossPaisa: grossOf,
      returnsPaisa: returnsOf,
    })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .where(saleWindow(storeId, range))
    .groupBy(key)
    .all()
    .map((group) => ({
      key: group.key,
      label: group.label,
      pieceQtyMilli: group.pieceQtyMilli,
      kgQtyMilli: group.kgQtyMilli,
      litreQtyMilli: group.litreQtyMilli,
      grossPaisa: group.grossPaisa,
      returnsPaisa: group.returnsPaisa,
      netPaisa: group.grossPaisa - group.returnsPaisa,
    }));
}

function ordered<T extends { netPaisa: number }>(
  rows: (T & { label: string; isMisc: boolean })[],
): (T & { label: string; isMisc: boolean })[] {
  return rows.toSorted(
    (a, b) =>
      Number(a.isMisc) - Number(b.isMisc) ||
      b.netPaisa - a.netPaisa ||
      a.label.localeCompare(b.label),
  );
}

export function readSalesByProduct(
  database: VendoraDatabase,
  storeId: string,
  range: ReportRange,
): SalesByProductResult {
  const misc = miscProductId(database, storeId);
  const groups = readGroups(
    database,
    storeId,
    range,
    sql<string>`${saleLines.productId}`,
    sql<string>`${saleLines.nameEn}`,
  );
  const rows = ordered(
    groups.map(({ key, label, ...totals }) => ({
      ...totals,
      label: key === misc ? miscItemsLabel : (label ?? ""),
      isMisc: key === misc,
    })),
  ).map((row) => ({ product: row.label, ...lineValues(row) }));
  return {
    rows,
    totals: sumTotals(rows, lineKeys),
    footer: roundingFooter(database, storeId, range),
  };
}

export function readSalesByCategory(
  database: VendoraDatabase,
  storeId: string,
  range: ReportRange,
): SalesByCategoryResult {
  const misc = miscProductId(database, storeId);
  const miscCondition = misc === null ? sql`0` : sql`${saleLines.productId} = ${misc}`;
  const groups = readGroups(
    database,
    storeId,
    range,
    sql<string>`CASE WHEN ${miscCondition} THEN '' ELSE coalesce(${saleLines.categoryId}, '-') END`,
    sql<string | null>`${saleLines.categoryName}`,
  );
  const rows = ordered(
    groups.map(({ key, label, ...totals }) => ({
      ...totals,
      label:
        key === "" ? miscItemsLabel : key === "-" ? noCategoryLabel : (label ?? noCategoryLabel),
      isMisc: key === "",
    })),
  ).map((row) => ({ category: row.label, ...lineValues(row) }));
  return {
    rows,
    totals: sumTotals(rows, lineKeys),
    footer: roundingFooter(database, storeId, range),
  };
}

export function readSalesByCashier(
  database: VendoraDatabase,
  storeId: string,
  range: ReportRange,
): SalesByCashierResult {
  const where = saleWindow(storeId, range);
  const bills = database.db
    .select({ cashierId: sales.cashierUserId, billCount: sql<number>`count(*)` })
    .from(sales)
    .where(where)
    .groupBy(sales.cashierUserId)
    .all();
  const lines = database.db
    .select({ cashierId: sales.cashierUserId, grossPaisa: grossOf, returnsPaisa: returnsOf })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .where(where)
    .groupBy(sales.cashierUserId)
    .all();
  const lineById = new Map(lines.map((line) => [line.cashierId, line]));
  const names = new Map(
    bills.length === 0
      ? []
      : database.db
          .select({ id: users.id, displayName: users.displayName })
          .from(users)
          .where(
            inArray(
              users.id,
              bills.map((bill) => bill.cashierId),
            ),
          )
          .all()
          .map((user) => [user.id, user.displayName]),
  );

  const rows = bills
    .map((bill) => {
      const line = lineById.get(bill.cashierId);
      const grossPaisa = line?.grossPaisa ?? 0;
      const returnsPaisa = line?.returnsPaisa ?? 0;
      return {
        cashier: names.get(bill.cashierId) ?? "",
        billCount: bill.billCount,
        grossPaisa,
        returnsPaisa,
        netPaisa: grossPaisa - returnsPaisa,
      };
    })
    .toSorted((a, b) => b.netPaisa - a.netPaisa || a.cashier.localeCompare(b.cashier));
  return {
    rows,
    totals: sumTotals(rows, ["billCount", "grossPaisa", "returnsPaisa", "netPaisa"] as const),
    footer: roundingFooter(database, storeId, range),
  };
}
