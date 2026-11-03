import { and, asc, count, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import type { VendoraDatabase } from "../db/client";
import { productBarcodes, products } from "../db/schema";
import {
  PRODUCT_SEARCH_MAX_LIMIT,
  type ProductSearchInput,
  type ProductSearchResult,
} from "../../shared/products";
import { normalizeSearchText } from "./search-text";

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function searchProducts(
  database: VendoraDatabase,
  storeId: string,
  input: ProductSearchInput,
): ProductSearchResult {
  const { db } = database;
  const normalized = normalizeSearchText(input.query);
  const terms = normalized === "" ? [] : normalized.split(" ");

  const filters: SQL[] = [
    eq(products.storeId, storeId),
    isNull(products.deletedAt),
    eq(products.isSystem, false),
  ];
  if (!input.includeArchived) filters.push(eq(products.isActive, true));
  if (input.categoryId) filters.push(eq(products.categoryId, input.categoryId));

  const barcodeProductId =
    terms.length > 0
      ? db
          .select({ id: products.id })
          .from(productBarcodes)
          .innerJoin(products, eq(products.id, productBarcodes.productId))
          .where(
            and(
              eq(productBarcodes.storeId, storeId),
              eq(productBarcodes.barcode, input.query.trim()),
              isNull(productBarcodes.deletedAt),
              ...filters,
            ),
          )
          .get()?.id
      : undefined;

  // ESCAPE makes the backslash-escaped %, _ and \ in the pattern literal.
  const textMatch = and(
    ...terms.map((term) => sql`${products.searchText} LIKE ${`%${escapeLike(term)}%`} ESCAPE '\\'`),
  );
  const match = barcodeProductId ? or(textMatch, eq(products.id, barcodeProductId)) : textMatch;
  const where = and(...filters, match);

  const limit = Math.min(Math.max(Math.trunc(input.limit), 1), PRODUCT_SEARCH_MAX_LIMIT);
  const offset = Math.max(Math.trunc(input.offset), 0);

  const order: SQL[] = [];
  if (barcodeProductId) {
    order.push(sql`CASE WHEN ${products.id} = ${barcodeProductId} THEN 0 ELSE 1 END`);
  }
  order.push(sql`lower(${products.nameEn})`, asc(products.nameEn), asc(products.id));

  const items = db
    .select({
      id: products.id,
      nameEn: products.nameEn,
      nameUr: products.nameUr,
      internalCode: products.internalCode,
      categoryId: products.categoryId,
      unit: products.unit,
      salePricePaisa: products.salePricePaisa,
      isActive: products.isActive,
    })
    .from(products)
    .where(where)
    .orderBy(...order)
    .limit(limit)
    .offset(offset)
    .all();

  const totalRow = db.select({ total: count() }).from(products).where(where).get();

  return { items, total: totalRow?.total ?? 0 };
}
