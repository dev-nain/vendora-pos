import { asc, desc, eq, sql } from "drizzle-orm";
import type {
  ReportRange,
  SalesTaxSummaryResult,
  SalesTaxSummaryTotals,
} from "../../shared/reports";
import type { VendoraDatabase } from "../db/client";
import { saleLines, sales } from "../db/schema";
import { rateText } from "../receipts/receipt-model";
import { saleWindow } from "./sales-by-day";

export function readSalesTaxSummary(
  database: VendoraDatabase,
  storeId: string,
  range: ReportRange,
): SalesTaxSummaryResult {
  const found = database.db
    .select({
      rateBps: saleLines.taxRateBps,
      isThirdSchedule: saleLines.isThirdSchedule,
      taxablePaisa: sql<number>`coalesce(sum(${saleLines.totalPaisa} - ${saleLines.taxPaisa}), 0)`,
      taxPaisa: sql<number>`coalesce(sum(${saleLines.taxPaisa}), 0)`,
      totalPaisa: sql<number>`coalesce(sum(${saleLines.totalPaisa}), 0)`,
    })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .where(saleWindow(storeId, range))
    .groupBy(saleLines.taxRateBps, saleLines.isThirdSchedule)
    .orderBy(desc(saleLines.taxRateBps), asc(saleLines.isThirdSchedule))
    .all();

  const rows = found.map(({ rateBps, isThirdSchedule, ...amounts }) => ({
    rate: isThirdSchedule ? `${rateText(rateBps)} · Third Schedule` : rateText(rateBps),
    ...amounts,
  }));

  const totals = rows.reduce<SalesTaxSummaryTotals>(
    (sum, row) => ({
      taxablePaisa: sum.taxablePaisa + row.taxablePaisa,
      taxPaisa: sum.taxPaisa + row.taxPaisa,
      totalPaisa: sum.totalPaisa + row.totalPaisa,
    }),
    { taxablePaisa: 0, taxPaisa: 0, totalPaisa: 0 },
  );

  return { rows, totals };
}
