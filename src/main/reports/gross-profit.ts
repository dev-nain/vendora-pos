import { and, eq, sql, type SQL } from "drizzle-orm";
import {
  miscItemsLabel,
  roundingRowLabel,
  type GrossProfitByCategoryResult,
  type GrossProfitByProductResult,
  type GrossProfitTotals,
  type ReportFooterRow,
  type ReportRange,
} from "../../shared/reports";
import { assertInteger, divRoundHalfUp } from "../../shared/rounding";
import type { VendoraDatabase } from "../db/client";
import { products, saleLines, sales } from "../db/schema";
import { saleWindow } from "./sales-by-day";

const noCategoryLabel = "No category";

export function marginBps(grossProfitPaisa: number, netPaisa: number): number | null {
  assertInteger(grossProfitPaisa, "gross profit");
  assertInteger(netPaisa, "net sales");
  if (netPaisa === 0) return null;
  const sign = netPaisa < 0 ? -1n : 1n;
  return divRoundHalfUp(BigInt(grossProfitPaisa) * 10000n * sign, BigInt(Math.abs(netPaisa)));
}

// SQLite integer `/` truncates toward zero, so half-up needs this explicit form.
export function halfUpDiv(expression: SQL, divisor: number): SQL {
  const d = sql.raw(String(divisor));
  return sql`(case when ${expression} < 0 then -((-(${expression}) * 2 + ${d}) / (2 * ${d})) else ((${expression}) * 2 + ${d}) / (2 * ${d}) end)`;
}

const baseQty = halfUpDiv(sql`(${saleLines.qtyMilli} * ${saleLines.packQtyMilli})`, 1000);
const lineCost = halfUpDiv(sql`(${baseQty} * ${saleLines.costPaisa})`, 1000);

const quantityOf = (unit: "piece" | "kg" | "litre") =>
  sql<number>`coalesce(sum(case when ${saleLines.unit} = ${unit} then ${baseQty} else 0 end), 0)`;

interface Group {
  label: string | null;
  isMisc: boolean;
  pieceQtyMilli: number;
  kgQtyMilli: number;
  litreQtyMilli: number;
  netPaisa: number;
  costPaisa: number;
}

interface Line {
  label: string;
  isMisc: boolean;
  pieceQtyMilli: number;
  kgQtyMilli: number;
  litreQtyMilli: number;
  netPaisa: number;
  costPaisa: number | null;
  grossProfitPaisa: number | null;
  marginBps: number | null;
}

function readGroups(
  database: VendoraDatabase,
  storeId: string,
  range: ReportRange,
  by: "product" | "category",
): { groups: Group[]; roundingPaisa: number } {
  const misc = database.db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.isSystem, true)))
    .get();
  const isMisc: SQL = misc ? sql`${saleLines.productId} = ${misc.id}` : sql`0`;
  const groupKey =
    by === "product"
      ? sql`${saleLines.productId}`
      : sql`case when ${isMisc} then '' else coalesce(${saleLines.categoryId}, '-') end`;
  const label = by === "product" ? saleLines.nameEn : saleLines.categoryName;
  const where = saleWindow(storeId, range);

  const groups = database.db
    .select({
      latest: sql<number>`max(${saleLines.createdAt})`,
      label,
      isMisc: sql<number>`${isMisc}`,
      pieceQtyMilli: quantityOf("piece"),
      kgQtyMilli: quantityOf("kg"),
      litreQtyMilli: quantityOf("litre"),
      netPaisa: sql<number>`coalesce(sum(${saleLines.totalPaisa} - ${saleLines.taxPaisa}), 0)`,
      costPaisa: sql<number>`coalesce(sum(${lineCost}), 0)`,
    })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .where(where)
    .groupBy(groupKey)
    .all()
    .map(({ latest: _latest, isMisc: flag, ...group }) => ({ ...group, isMisc: flag === 1 }));

  const rounding = database.db
    .select({ total: sql<number>`coalesce(sum(${sales.roundingPaisa}), 0)` })
    .from(sales)
    .where(where)
    .get();

  return { groups, roundingPaisa: rounding?.total ?? 0 };
}

function toLines(groups: Group[]): Line[] {
  return groups.map((group) => {
    const quantities = {
      pieceQtyMilli: group.pieceQtyMilli,
      kgQtyMilli: group.kgQtyMilli,
      litreQtyMilli: group.litreQtyMilli,
      netPaisa: group.netPaisa,
    };
    if (group.isMisc) {
      return {
        label: miscItemsLabel,
        isMisc: true,
        ...quantities,
        costPaisa: null,
        grossProfitPaisa: null,
        marginBps: null,
      };
    }
    const grossProfitPaisa = group.netPaisa - group.costPaisa;
    return {
      label: group.label ?? noCategoryLabel,
      isMisc: false,
      ...quantities,
      costPaisa: group.costPaisa,
      grossProfitPaisa,
      marginBps: marginBps(grossProfitPaisa, group.netPaisa),
    };
  });
}

const byNetThenLabel = (a: Line, b: Line): number =>
  Number(a.isMisc) - Number(b.isMisc) || b.netPaisa - a.netPaisa || a.label.localeCompare(b.label);

function totalsOf(lines: Line[]): GrossProfitTotals {
  const totals = { pieceQtyMilli: 0, kgQtyMilli: 0, litreQtyMilli: 0, netPaisa: 0 };
  let costPaisa = 0;
  let grossProfitPaisa = 0;
  let costedNetPaisa = 0;
  for (const line of lines) {
    totals.pieceQtyMilli += line.pieceQtyMilli;
    totals.kgQtyMilli += line.kgQtyMilli;
    totals.litreQtyMilli += line.litreQtyMilli;
    totals.netPaisa += line.netPaisa;
    if (line.costPaisa === null || line.grossProfitPaisa === null) continue;
    costPaisa += line.costPaisa;
    grossProfitPaisa += line.grossProfitPaisa;
    costedNetPaisa += line.netPaisa;
  }
  return {
    ...totals,
    costPaisa,
    grossProfitPaisa,
    marginBps: marginBps(grossProfitPaisa, costedNetPaisa),
  };
}

const footerOf = (roundingPaisa: number): ReportFooterRow[] =>
  roundingPaisa === 0 ? [] : [{ label: roundingRowLabel, values: { netPaisa: roundingPaisa } }];

function read(
  database: VendoraDatabase,
  storeId: string,
  range: ReportRange,
  by: "product" | "category",
) {
  const { groups, roundingPaisa } = readGroups(database, storeId, range, by);
  const lines = toLines(groups).toSorted(byNetThenLabel);
  return { lines, totals: totalsOf(lines), footer: footerOf(roundingPaisa) };
}

const lineValues = ({ label: _label, isMisc: _isMisc, ...values }: Line) => values;

export function readGrossProfitByProduct(
  database: VendoraDatabase,
  storeId: string,
  range: ReportRange,
): GrossProfitByProductResult {
  const { lines, totals, footer } = read(database, storeId, range, "product");
  return {
    rows: lines.map((line) => ({ product: line.label, ...lineValues(line) })),
    totals,
    footer,
  };
}

export function readGrossProfitByCategory(
  database: VendoraDatabase,
  storeId: string,
  range: ReportRange,
): GrossProfitByCategoryResult {
  const { lines, totals, footer } = read(database, storeId, range, "category");
  return {
    rows: lines.map((line) => ({ category: line.label, ...lineValues(line) })),
    totals,
    footer,
  };
}
