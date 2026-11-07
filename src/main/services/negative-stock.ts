import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { NegativeStockItem } from "../../shared/inventory";
import type { VendoraDatabase } from "../db/client";
import { products, stockMovements } from "../db/schema";
import { stockValuePaisa } from "./stock-value";

export function listNegativeStock(database: VendoraDatabase, storeId: string): NegativeStockItem[] {
  const { db } = database;
  const totals = db
    .select({
      productId: stockMovements.productId,
      onHandMilli: sql<number>`sum(${stockMovements.qtyMilli})`.as("on_hand_milli"),
      lastMovementAt: sql<number>`max(${stockMovements.createdAt})`.as("last_movement_at"),
    })
    .from(stockMovements)
    .groupBy(stockMovements.productId)
    .having(sql`sum(${stockMovements.qtyMilli}) < 0`)
    .as("totals");

  return db
    .select({
      id: products.id,
      nameEn: products.nameEn,
      nameUr: products.nameUr,
      unit: products.unit,
      costPaisa: products.costPaisa,
      onHandMilli: totals.onHandMilli,
      lastMovementAt: totals.lastMovementAt,
    })
    .from(totals)
    .innerJoin(products, eq(products.id, totals.productId))
    .where(
      and(
        eq(products.storeId, storeId),
        isNull(products.deletedAt),
        eq(products.isSystem, false),
        eq(products.isActive, true),
      ),
    )
    .orderBy(asc(sql`lower(${products.nameEn})`), asc(products.nameEn), asc(products.id))
    .all()
    .map((row) => ({
      id: row.id,
      nameEn: row.nameEn,
      nameUr: row.nameUr,
      unit: row.unit,
      onHandMilli: row.onHandMilli,
      stockValuePaisa: stockValuePaisa(row.onHandMilli, row.costPaisa),
      lastMovementAt: new Date(row.lastMovementAt).toISOString(),
    }));
}
