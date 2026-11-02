import { and, eq, isNull } from "drizzle-orm";
import type { VendoraDatabase } from "../db/client";
import { productBarcodes, products, type ProductUnit } from "../db/schema";

export interface BarcodeLookupProduct {
  id: string;
  nameEn: string;
  nameUr: string | null;
  unit: ProductUnit;
  salePricePaisa: number;
  taxCategoryId: string;
  costPaisa: number;
}

export interface BarcodeLookup {
  product: BarcodeLookupProduct;
  packQtyMilli: number;
  packPricePaisa: number | null;
}

export function lookupBarcode(
  database: VendoraDatabase,
  storeId: string,
  barcode: string,
): BarcodeLookup | null {
  const code = barcode.trim();
  if (code === "") return null;

  const row = database.db
    .select({
      id: products.id,
      nameEn: products.nameEn,
      nameUr: products.nameUr,
      unit: products.unit,
      salePricePaisa: products.salePricePaisa,
      taxCategoryId: products.taxCategoryId,
      costPaisa: products.costPaisa,
      packQtyMilli: productBarcodes.packQtyMilli,
      packPricePaisa: productBarcodes.salePricePaisa,
    })
    .from(productBarcodes)
    .innerJoin(products, eq(products.id, productBarcodes.productId))
    .where(
      and(
        eq(productBarcodes.storeId, storeId),
        eq(productBarcodes.barcode, code),
        isNull(productBarcodes.deletedAt),
        eq(products.storeId, storeId),
        isNull(products.deletedAt),
        eq(products.isActive, true),
      ),
    )
    .get();
  if (!row) return null;

  const { packQtyMilli, packPricePaisa, ...product } = row;
  return { product, packQtyMilli, packPricePaisa };
}
