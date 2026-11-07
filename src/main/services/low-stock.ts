import { and, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { LowStockQuery, LowStockResult } from "../../shared/inventory";
import type { VendoraDatabase } from "../db/client";
import { products, stockMovements } from "../db/schema";

export function lowStockProducts(
  database: VendoraDatabase,
  storeId: string,
  input: LowStockQuery,
): LowStockResult {
  const filters: SQL[] = [
    eq(products.storeId, storeId),
    isNull(products.deletedAt),
    eq(products.isSystem, false),
    eq(products.isActive, true),
    isNotNull(products.lowStockThresholdMilli),
  ];
  if (input.categoryId) filters.push(eq(products.categoryId, input.categoryId));

  const onHand = sql<number>`coalesce(sum(${stockMovements.qtyMilli}), 0)`;
  const rows = database.db
    .select({
      id: products.id,
      nameEn: products.nameEn,
      nameUr: products.nameUr,
      categoryId: products.categoryId,
      unit: products.unit,
      thresholdMilli: products.lowStockThresholdMilli,
      onHandMilli: onHand,
    })
    .from(products)
    .leftJoin(stockMovements, eq(stockMovements.productId, products.id))
    .where(and(...filters))
    .groupBy(products.id)
    .having(sql`${onHand} <= ${products.lowStockThresholdMilli}`)
    .orderBy(sql`lower(${products.nameEn})`, products.nameEn, products.id)
    .all();

  const start = input.offset;
  const items = rows.slice(start, start + input.limit).map(({ thresholdMilli, ...row }) => {
    const threshold = thresholdMilli ?? 0;
    return { ...row, thresholdMilli: threshold, shortfallMilli: threshold - row.onHandMilli };
  });
  return { items, total: rows.length };
}
