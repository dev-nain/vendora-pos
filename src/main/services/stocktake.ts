import { and, asc, count, eq, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { productMessages } from "../../shared/products";
import {
  stocktakeMessages,
  type CancelStocktakeResult,
  type StartStocktakeInput,
  type StartStocktakeResult,
  type StocktakeLine,
  type StocktakeLinesQuery,
  type StocktakeLinesResult,
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
import { outerProductId, searchTextMatch } from "./product-search";
import { normalizeSearchText } from "./search-text";
import type { StockService } from "./stock";

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

    const rows = db
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
      .innerJoin(categories, eq(categories.id, products.categoryId))
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
    const items: StocktakeLine[] = rows.map((row) => ({
      ...row,
      countedAt: row.countedAt ? row.countedAt.toISOString() : null,
      onHandMilli: onHand.get(row.productId) ?? 0,
    }));
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

  return { current, start, lines, cancel };
}
export type StocktakeService = ReturnType<typeof createStocktakeService>;
