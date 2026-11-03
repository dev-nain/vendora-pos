import { and, eq, isNull } from "drizzle-orm";
import type { VendoraDatabase } from "../db/client";
import { productBarcodes, products } from "../db/schema";
import type { BarcodeLookup } from "../../shared/products";
import { parseScaleBarcode } from "../hardware/scale-barcode";
import { getScalePrefixes } from "../settings/store-settings";

const productColumns = {
  id: products.id,
  nameEn: products.nameEn,
  nameUr: products.nameUr,
  unit: products.unit,
  salePricePaisa: products.salePricePaisa,
  taxCategoryId: products.taxCategoryId,
  costPaisa: products.costPaisa,
};

export function lookupBarcode(
  database: VendoraDatabase,
  storeId: string,
  barcode: string,
): BarcodeLookup | null {
  const code = barcode.trim();
  if (code === "") return null;

  const row = database.db
    .select({
      ...productColumns,
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
  if (row) {
    const { packQtyMilli, packPricePaisa, ...product } = row;
    return { source: "barcode", product, packQtyMilli, packPricePaisa };
  }

  return lookupScaleBarcode(database, storeId, code);
}

function lookupScaleBarcode(
  database: VendoraDatabase,
  storeId: string,
  code: string,
): BarcodeLookup | null {
  if (!/^\d{13}$/.test(code)) return null;

  const scale = parseScaleBarcode(code, getScalePrefixes(database, storeId));
  if (!scale) return null;

  const product = database.db
    .select(productColumns)
    .from(products)
    .where(
      and(
        eq(products.storeId, storeId),
        eq(products.internalCode, scale.itemCode),
        isNull(products.deletedAt),
        eq(products.isActive, true),
      ),
    )
    .get();
  if (!product) return null;
  if (scale.kind === "weight" && product.unit !== "kg") return null;

  return { source: "scale", product, scale };
}
