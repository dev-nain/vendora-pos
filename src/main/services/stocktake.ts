import { alias } from "drizzle-orm/sqlite-core";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { checkoutMessages } from "../../shared/checkout";
import { productMessages } from "../../shared/products";
import {
  stocktakeMessages,
  type CancelStocktakeResult,
  type PastStocktakesQuery,
  type PastStocktakesResult,
  type StocktakeReview,
  type StocktakeReviewLinesQuery,
  type StocktakeReviewLinesResult,
  type StocktakeReviewResult,
  type StartStocktakeInput,
  type RecordCountInput,
  type RecordCountResult,
  type StartStocktakeResult,
  type StocktakeLine,
  type StocktakeLinesQuery,
  type StocktakeLinesResult,
  type StocktakeScanInput,
  type StocktakeScanResult,
  type StocktakeSummary,
} from "../../shared/stocktake";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import {
  categories,
  products,
  stockMovements,
  stocktakeLines,
  stocktakes,
  users,
} from "../db/schema";
import { isUniqueViolation } from "../db/sqlite-errors";
import { currentTerminal, type DbExecutor } from "../db/terminal";
import { lookupBarcode } from "./barcode-lookup";
import { outerProductId, searchTextMatch } from "./product-search";
import { normalizeSearchText } from "./search-text";
import type { StockService } from "./stock";
import { lineVariance, varianceTotals } from "./stocktake-variance";

const LINE_INSERT_CHUNK = 500;

interface StocktakeDeps {
  database: VendoraDatabase;
  sessions: SessionStore;
  stock: StockService;
  now?: () => Date;
}

const refuse = <Reason extends string>(reason: Reason, message: string) =>
  ({ ok: false, reason, message }) as const;

function countedCountOf(executor: DbExecutor, stocktakeId: string): number {
  return (
    executor
      .select({ n: count() })
      .from(stocktakeLines)
      .where(and(eq(stocktakeLines.stocktakeId, stocktakeId), isNotNull(stocktakeLines.countedAt)))
      .get()?.n ?? 0
  );
}

function summaryOf(executor: DbExecutor, storeId: string, stocktakeId: string) {
  const row = executor
    .select({
      id: stocktakes.id,
      scope: stocktakes.scope,
      categoryName: categories.name,
      startedByName: users.displayName,
      startedAt: stocktakes.createdAt,
    })
    .from(stocktakes)
    .innerJoin(users, eq(users.id, stocktakes.startedBy))
    .leftJoin(categories, eq(categories.id, stocktakes.categoryId))
    .where(and(eq(stocktakes.id, stocktakeId), eq(stocktakes.storeId, storeId)))
    .get();
  if (!row) return null;
  const lineCount =
    executor
      .select({ n: count() })
      .from(stocktakeLines)
      .where(eq(stocktakeLines.stocktakeId, stocktakeId))
      .get()?.n ?? 0;
  const summary: StocktakeSummary = {
    id: row.id,
    scope: row.scope,
    categoryName: row.categoryName,
    startedByName: row.startedByName,
    startedAt: row.startedAt.toISOString(),
    lineCount,
    countedCount: countedCountOf(executor, stocktakeId),
  };
  return summary;
}

function findOpen(executor: DbExecutor, storeId: string): string | null {
  return (
    executor
      .select({ id: stocktakes.id })
      .from(stocktakes)
      .where(and(eq(stocktakes.storeId, storeId), eq(stocktakes.status, "open")))
      .get()?.id ?? null
  );
}

function isOpen(executor: DbExecutor, storeId: string, stocktakeId: string): boolean {
  return (
    executor
      .select({ id: stocktakes.id })
      .from(stocktakes)
      .where(
        and(
          eq(stocktakes.id, stocktakeId),
          eq(stocktakes.storeId, storeId),
          eq(stocktakes.status, "open"),
        ),
      )
      .get() !== undefined
  );
}

function lineSelect(executor: DbExecutor) {
  return executor
    .select({
      id: stocktakeLines.id,
      productId: products.id,
      nameEn: products.nameEn,
      nameUr: products.nameUr,
      unit: products.unit,
      isActive: products.isActive,
      categoryName: categories.name,
      countedMilli: stocktakeLines.countedQtyMilli,
      countedAt: stocktakeLines.countedAt,
    })
    .from(stocktakeLines)
    .innerJoin(products, eq(products.id, stocktakeLines.productId))
    .innerJoin(categories, eq(categories.id, products.categoryId));
}

function countedRows(
  executor: DbExecutor,
  stocktakeId: string,
  cost: typeof products.costPaisa | typeof stocktakeLines.unitCostPaisa,
) {
  return executor
    .select({
      productId: stocktakeLines.productId,
      expectedMilli: stocktakeLines.expectedQtyMilli,
      countedMilli: stocktakeLines.countedQtyMilli,
      costPaisa: cost,
    })
    .from(stocktakeLines)
    .innerJoin(products, eq(products.id, stocktakeLines.productId))
    .where(and(eq(stocktakeLines.stocktakeId, stocktakeId), isNotNull(stocktakeLines.countedAt)))
    .all()
    .map((row) => {
      if (row.expectedMilli === null || row.countedMilli === null || row.costPaisa === null) {
        throw new Error("Counted stocktake line is missing its expected quantity or cost");
      }
      return {
        productId: row.productId,
        ...lineVariance({
          countedMilli: row.countedMilli,
          expectedMilli: row.expectedMilli,
          costPaisa: row.costPaisa,
        }),
      };
    });
}

function toLine(
  row: Omit<StocktakeLine, "countedAt" | "onHandMilli"> & { countedAt: Date | null },
  onHandMilli: number,
): StocktakeLine {
  return { ...row, countedAt: row.countedAt ? row.countedAt.toISOString() : null, onHandMilli };
}

export function createStocktakeService({
  database,
  sessions,
  stock,
  now = () => new Date(),
}: StocktakeDeps) {
  const { db } = database;

  function current(): StocktakeSummary | null {
    const session = requireSession(sessions);
    const openId = findOpen(db, session.storeId);
    return openId ? summaryOf(db, session.storeId, openId) : null;
  }

  function start(input: StartStocktakeInput): StartStocktakeResult {
    const session = requireSession(sessions);
    const alreadyOpen = refuse("already-open", stocktakeMessages.alreadyOpen);
    try {
      return db.transaction((tx) => {
        if (findOpen(tx, session.storeId)) return alreadyOpen;

        let categoryId: string | null = null;
        if (input.scope === "category") {
          const category = tx
            .select({ id: categories.id })
            .from(categories)
            .where(
              and(
                eq(categories.id, input.categoryId),
                eq(categories.storeId, session.storeId),
                isNull(categories.deletedAt),
              ),
            )
            .get();
          if (!category) return refuse("category-not-found", productMessages.categoryNotFound);
          categoryId = category.id;
        }

        const filters: SQL[] = [
          eq(products.storeId, session.storeId),
          isNull(products.deletedAt),
          eq(products.isSystem, false),
        ];
        if (categoryId) filters.push(eq(products.categoryId, categoryId));
        const hasStock = sql`coalesce((SELECT sum(${stockMovements.qtyMilli}) FROM ${stockMovements} WHERE ${stockMovements.productId} = ${outerProductId}), 0) <> 0`;
        const productIds = tx
          .select({ id: products.id })
          .from(products)
          .where(and(...filters, or(eq(products.isActive, true), hasStock)))
          .all()
          .map((row) => row.id);
        if (productIds.length === 0) return refuse("no-products", stocktakeMessages.noProducts);

        const terminal = currentTerminal(tx);
        const stocktake = tx
          .insert(stocktakes)
          .values({
            storeId: session.storeId,
            terminalId: terminal.id,
            scope: input.scope,
            categoryId,
            startedBy: session.userId,
            createdAt: now(),
          })
          .returning({ id: stocktakes.id })
          .get();

        for (let i = 0; i < productIds.length; i += LINE_INSERT_CHUNK) {
          tx.insert(stocktakeLines)
            .values(
              productIds.slice(i, i + LINE_INSERT_CHUNK).map((productId) => ({
                storeId: session.storeId,
                terminalId: terminal.id,
                stocktakeId: stocktake.id,
                productId,
              })),
            )
            .run();
        }

        const summary = summaryOf(tx, session.storeId, stocktake.id);
        if (!summary) throw new Error("Stocktake vanished inside its transaction");
        return { ok: true, stocktake: summary };
      });
    } catch (error) {
      if (isUniqueViolation(error)) return alreadyOpen;
      throw error;
    }
  }

  function lines(input: StocktakeLinesQuery): StocktakeLinesResult {
    const session = requireSession(sessions);
    if (!isOpen(db, session.storeId, input.stocktakeId)) {
      return refuse("not-open", stocktakeMessages.notOpen);
    }

    const normalized = normalizeSearchText(input.query);
    const terms = normalized === "" ? [] : normalized.split(" ");
    const where = and(eq(stocktakeLines.stocktakeId, input.stocktakeId), searchTextMatch(terms));

    const rows = lineSelect(db)
      .where(where)
      .orderBy(sql`lower(${products.nameEn})`, asc(products.nameEn), asc(products.id))
      .limit(input.limit)
      .offset(input.offset)
      .all();
    const total =
      db
        .select({ n: count() })
        .from(stocktakeLines)
        .innerJoin(products, eq(products.id, stocktakeLines.productId))
        .where(where)
        .get()?.n ?? 0;

    const onHand = stock.onHandMany(rows.map((row) => row.productId));
    const items = rows.map((row) => toLine(row, onHand.get(row.productId) ?? 0));
    return { ok: true, items, total };
  }

  function cancel(input: { stocktakeId: string }): CancelStocktakeResult {
    const session = requireSession(sessions);
    const result = db
      .update(stocktakes)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(stocktakes.id, input.stocktakeId),
          eq(stocktakes.storeId, session.storeId),
          eq(stocktakes.status, "open"),
        ),
      )
      .run();
    return result.changes === 0 ? refuse("not-open", stocktakeMessages.notOpen) : { ok: true };
  }

  function scan(input: StocktakeScanInput): StocktakeScanResult {
    const session = requireSession(sessions);
    if (!isOpen(db, session.storeId, input.stocktakeId)) {
      return refuse("not-open", stocktakeMessages.notOpen);
    }

    const found = lookupBarcode(database, session.storeId, input.barcode, {
      includeArchived: true,
    });
    if (!found) return refuse("unknown-barcode", checkoutMessages.productNotFound);

    const row = lineSelect(db)
      .where(
        and(
          eq(stocktakeLines.stocktakeId, input.stocktakeId),
          eq(stocktakeLines.productId, found.product.id),
        ),
      )
      .get();
    if (!row) return refuse("out-of-scope", stocktakeMessages.outOfScope(found.product.nameEn));

    return {
      ok: true,
      line: toLine(row, stock.onHand(row.productId)),
      packQtyMilli: found.source === "barcode" ? found.packQtyMilli : 1000,
    };
  }

  function record(input: RecordCountInput): RecordCountResult {
    const session = requireSession(sessions);
    return db.transaction((tx) => {
      if (!isOpen(tx, session.storeId, input.stocktakeId)) {
        return refuse("not-open", stocktakeMessages.notOpen);
      }

      const row = lineSelect(tx)
        .where(
          and(
            eq(stocktakeLines.id, input.lineId),
            eq(stocktakeLines.stocktakeId, input.stocktakeId),
            eq(stocktakeLines.storeId, session.storeId),
          ),
        )
        .get();
      if (!row) return refuse("not-found", stocktakeMessages.lineNotFound);
      if (row.unit === "piece" && input.countedMilli % 1000 !== 0) {
        return refuse("whole-units", stocktakeMessages.wholeUnits);
      }

      const expected = stock.onHand(row.productId, tx);
      const countedAt = now();
      tx.update(stocktakeLines)
        .set({
          expectedQtyMilli: expected,
          countedQtyMilli: input.countedMilli,
          countedAt,
        })
        .where(eq(stocktakeLines.id, row.id))
        .run();

      return {
        ok: true,
        line: toLine({ ...row, countedMilli: input.countedMilli, countedAt }, expected),
        countedCount: countedCountOf(tx, input.stocktakeId),
      };
    });
  }

  function review(input: { stocktakeId: string }): StocktakeReviewResult {
    const session = requireSession(sessions);
    const postedBy = alias(users, "posted_by_user");
    const row = db
      .select({
        status: stocktakes.status,
        postedAt: stocktakes.postedAt,
        postedByName: postedBy.displayName,
      })
      .from(stocktakes)
      .leftJoin(postedBy, eq(postedBy.id, stocktakes.postedBy))
      .where(and(eq(stocktakes.id, input.stocktakeId), eq(stocktakes.storeId, session.storeId)))
      .get();
    const summary = summaryOf(db, session.storeId, input.stocktakeId);
    if (!row || !summary) return refuse("not-found", stocktakeMessages.notFound);

    const base = {
      ...summary,
      status: row.status,
      postedAt: row.postedAt ? row.postedAt.toISOString() : null,
      postedByName: row.postedByName,
      skippedCount: summary.lineCount - summary.countedCount,
    };
    if (row.status === "cancelled") {
      const varianceLineCount =
        db
          .select({ n: count() })
          .from(stocktakeLines)
          .where(
            and(
              eq(stocktakeLines.stocktakeId, input.stocktakeId),
              sql`${stocktakeLines.countedQtyMilli} <> ${stocktakeLines.expectedQtyMilli}`,
            ),
          )
          .get()?.n ?? 0;
      const cancelled: StocktakeReview = {
        ...base,
        varianceLineCount,
        shortValuePaisa: null,
        surplusValuePaisa: null,
        netValuePaisa: null,
      };
      return { ok: true, review: cancelled };
    }

    const cost = row.status === "open" ? products.costPaisa : stocktakeLines.unitCostPaisa;
    return {
      ok: true,
      review: { ...base, ...varianceTotals(countedRows(db, input.stocktakeId, cost)) },
    };
  }

  function reviewLines(query: StocktakeReviewLinesQuery): StocktakeReviewLinesResult {
    const session = requireSession(sessions);
    const header = db
      .select({ status: stocktakes.status })
      .from(stocktakes)
      .where(and(eq(stocktakes.id, query.stocktakeId), eq(stocktakes.storeId, session.storeId)))
      .get();
    if (!header) return refuse("not-found", stocktakeMessages.notFound);

    const filters: SQL[] = [eq(stocktakeLines.stocktakeId, query.stocktakeId)];
    if (query.filter === "variance") {
      filters.push(sql`${stocktakeLines.countedQtyMilli} <> ${stocktakeLines.expectedQtyMilli}`);
    } else if (query.filter === "uncounted") {
      filters.push(isNull(stocktakeLines.countedAt));
    }
    const where = and(...filters);

    const rows = db
      .select({
        id: stocktakeLines.id,
        productId: products.id,
        nameEn: products.nameEn,
        nameUr: products.nameUr,
        unit: products.unit,
        isActive: products.isActive,
        expectedMilli: stocktakeLines.expectedQtyMilli,
        countedMilli: stocktakeLines.countedQtyMilli,
        countedAt: stocktakeLines.countedAt,
        liveCostPaisa: products.costPaisa,
        frozenCostPaisa: stocktakeLines.unitCostPaisa,
      })
      .from(stocktakeLines)
      .innerJoin(products, eq(products.id, stocktakeLines.productId))
      .where(where)
      .orderBy(sql`lower(${products.nameEn})`, asc(products.nameEn), asc(products.id))
      .limit(query.limit)
      .offset(query.offset)
      .all();
    const total = db.select({ n: count() }).from(stocktakeLines).where(where).get()?.n ?? 0;

    const isOpenCount = header.status === "open";
    const liveOnHand = isOpenCount
      ? stock.onHandMany(rows.filter((row) => row.countedAt === null).map((row) => row.productId))
      : new Map<string, number>();

    const items = rows.map(({ liveCostPaisa, frozenCostPaisa, ...row }) => {
      const costPaisa = isOpenCount ? liveCostPaisa : frozenCostPaisa;
      const counted = row.countedMilli !== null && row.expectedMilli !== null;
      const varianceMilli = counted ? row.countedMilli! - row.expectedMilli! : null;
      const valued =
        counted && header.status !== "cancelled" && costPaisa !== null
          ? lineVariance({
              countedMilli: row.countedMilli!,
              expectedMilli: row.expectedMilli!,
              costPaisa,
            }).varianceValuePaisa
          : null;
      return {
        ...row,
        expectedMilli: counted ? row.expectedMilli : (liveOnHand.get(row.productId) ?? null),
        countedAt: row.countedAt ? row.countedAt.toISOString() : null,
        varianceMilli,
        varianceValuePaisa: valued,
      };
    });
    return { ok: true, items, total };
  }

  function listPast(query: PastStocktakesQuery): PastStocktakesResult {
    const session = requireSession(sessions);
    const where = and(
      eq(stocktakes.storeId, session.storeId),
      inArray(stocktakes.status, ["posted", "cancelled"]),
    );
    const rows = db
      .select({
        id: stocktakes.id,
        scope: stocktakes.scope,
        categoryName: categories.name,
        status: stocktakes.status,
        postedAt: stocktakes.postedAt,
        createdAt: stocktakes.createdAt,
      })
      .from(stocktakes)
      .leftJoin(categories, eq(categories.id, stocktakes.categoryId))
      .where(where)
      .orderBy(desc(stocktakes.createdAt), desc(stocktakes.id))
      .limit(query.limit)
      .offset(query.offset)
      .all();
    const total = db.select({ n: count() }).from(stocktakes).where(where).get()?.n ?? 0;
    return {
      items: rows.map((row) => ({
        id: row.id,
        scope: row.scope,
        categoryName: row.categoryName,
        status: row.status,
        date: (row.postedAt ?? row.createdAt).toISOString(),
      })),
      total,
    };
  }

  return { current, start, lines, scan, record, cancel, review, reviewLines, listPast };
}
export type StocktakeService = ReturnType<typeof createStocktakeService>;
