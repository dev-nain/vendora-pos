import { and, count, desc, eq, gte, isNotNull, lt, sql, type SQL } from "drizzle-orm";
import { storeDayBounds, type ReportRange } from "../../shared/reports";
import type { PostedStocktakesResult, StocktakeVarianceResult } from "../../shared/stock-reports";
import { stocktakeScopeLabel } from "../../shared/stocktake";
import type { VendoraDatabase } from "../db/client";
import { categories, products, stocktakeLines, stocktakes } from "../db/schema";
import { lineVariance, varianceTotals } from "../services/stocktake-variance";

function postedWindow(storeId: string, range: ReportRange): SQL[] {
  const { start, end } = storeDayBounds(range);
  return [
    eq(stocktakes.storeId, storeId),
    eq(stocktakes.status, "posted"),
    gte(stocktakes.postedAt, start),
    lt(stocktakes.postedAt, end),
  ];
}

export function readPostedStocktakes(
  database: VendoraDatabase,
  storeId: string,
  range: ReportRange,
): PostedStocktakesResult {
  const rows = database.db
    .select({
      id: stocktakes.id,
      postedAt: stocktakes.postedAt,
      scope: stocktakes.scope,
      categoryName: categories.name,
    })
    .from(stocktakes)
    .leftJoin(categories, eq(categories.id, stocktakes.categoryId))
    .where(and(...postedWindow(storeId, range)))
    .orderBy(desc(stocktakes.postedAt), desc(stocktakes.id))
    .all();
  return {
    items: rows.flatMap((row) =>
      row.postedAt
        ? [
            {
              id: row.id,
              postedAt: row.postedAt.toISOString(),
              label: stocktakeScopeLabel(row.scope, row.categoryName),
            },
          ]
        : [],
    ),
  };
}

export function readStocktakeVariance(
  database: VendoraDatabase,
  storeId: string,
  input: { range: ReportRange; stocktakeId: string | null },
): StocktakeVarianceResult {
  const { db } = database;
  const picked = input.stocktakeId ? [eq(stocktakes.id, input.stocktakeId)] : [];

  const countCount =
    db
      .select({ n: count() })
      .from(stocktakes)
      .where(and(...postedWindow(storeId, input.range), ...picked))
      .get()?.n ?? 0;

  const lines = db
    .select({
      lineId: stocktakeLines.id,
      postedAt: stocktakes.postedAt,
      scope: stocktakes.scope,
      categoryName: categories.name,
      product: products.nameEn,
      unit: products.unit,
      expectedMilli: stocktakeLines.expectedQtyMilli,
      countedMilli: stocktakeLines.countedQtyMilli,
      costPaisa: stocktakeLines.unitCostPaisa,
    })
    .from(stocktakeLines)
    .innerJoin(stocktakes, eq(stocktakes.id, stocktakeLines.stocktakeId))
    .innerJoin(products, eq(products.id, stocktakeLines.productId))
    .leftJoin(categories, eq(categories.id, stocktakes.categoryId))
    .where(
      and(
        ...postedWindow(storeId, input.range),
        ...picked,
        isNotNull(stocktakeLines.countedAt),
        sql`${stocktakeLines.countedQtyMilli} <> ${stocktakeLines.expectedQtyMilli}`,
      ),
    )
    .orderBy(
      desc(stocktakes.postedAt),
      sql`lower(${products.nameEn})`,
      products.nameEn,
      products.id,
    )
    .all();

  const rows = lines.map((line) => {
    if (
      line.postedAt === null ||
      line.expectedMilli === null ||
      line.countedMilli === null ||
      line.costPaisa === null
    ) {
      throw new Error("Posted stocktake line is missing its expected quantity or cost");
    }
    const { varianceMilli, varianceValuePaisa } = lineVariance({
      countedMilli: line.countedMilli,
      expectedMilli: line.expectedMilli,
      costPaisa: line.costPaisa,
    });
    return {
      lineId: line.lineId,
      postedAt: line.postedAt.toISOString(),
      count: stocktakeScopeLabel(line.scope, line.categoryName),
      product: line.product,
      unit: line.unit,
      expectedMilli: line.expectedMilli,
      countedMilli: line.countedMilli,
      varianceMilli,
      valuePaisa: varianceValuePaisa,
    };
  });

  const { shortValuePaisa, surplusValuePaisa, netValuePaisa } = varianceTotals(
    rows.map((row) => ({ varianceMilli: row.varianceMilli, varianceValuePaisa: row.valuePaisa })),
  );
  return {
    countCount,
    shortValuePaisa,
    surplusValuePaisa,
    rows,
    totals: { valuePaisa: netValuePaisa },
  };
}
