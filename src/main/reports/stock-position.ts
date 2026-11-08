import { and, asc, eq, sql } from "drizzle-orm";
import type {
  LowStockReportResult,
  NegativeStockReportResult,
  StockOnHandResult,
} from "../../shared/stock-reports";
import type { VendoraDatabase } from "../db/client";
import { categories, products } from "../db/schema";
import { lowStockRows } from "../services/low-stock";
import { listNegativeStock } from "../services/negative-stock";
import { productOnHandMilli, stockListFilters } from "../services/product-search";
import { stockValuePaisa } from "../services/stock-value";

export function readStockOnHand(
  database: VendoraDatabase,
  storeId: string,
  asOf: Date,
): StockOnHandResult {
  const rows = database.db
    .select({
      productId: products.id,
      product: products.nameEn,
      category: categories.name,
      unit: products.unit,
      onHandMilli: productOnHandMilli,
      costPaisa: products.costPaisa,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(...stockListFilters(storeId, {})))
    .orderBy(sql`lower(${products.nameEn})`, asc(products.nameEn), asc(products.id))
    .all()
    .map((row) => ({
      ...row,
      category: row.category ?? "",
      stockValuePaisa: stockValuePaisa(row.onHandMilli, row.costPaisa),
    }));
  return {
    asOf: asOf.toISOString(),
    rows,
    totals: { stockValuePaisa: rows.reduce((sum, row) => sum + row.stockValuePaisa, 0) },
  };
}

export function readLowStock(
  database: VendoraDatabase,
  storeId: string,
  asOf: Date,
): LowStockReportResult {
  const names = new Map(
    database.db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.storeId, storeId))
      .all()
      .map((row) => [row.id, row.name]),
  );
  return {
    asOf: asOf.toISOString(),
    rows: lowStockRows(database, storeId).map((row) => ({
      productId: row.id,
      product: row.nameEn,
      category: names.get(row.categoryId) ?? "",
      unit: row.unit,
      onHandMilli: row.onHandMilli,
      thresholdMilli: row.thresholdMilli,
      shortfallMilli: row.shortfallMilli,
    })),
    totals: {},
  };
}

export function readNegativeStock(
  database: VendoraDatabase,
  storeId: string,
  asOf: Date,
): NegativeStockReportResult {
  const rows = listNegativeStock(database, storeId).map((item) => ({
    productId: item.id,
    product: item.nameEn,
    unit: item.unit,
    onHandMilli: item.onHandMilli,
    stockValuePaisa: item.stockValuePaisa,
    lastMovementAt: item.lastMovementAt,
  }));
  return {
    asOf: asOf.toISOString(),
    rows,
    totals: { stockValuePaisa: rows.reduce((sum, row) => sum + row.stockValuePaisa, 0) },
  };
}
