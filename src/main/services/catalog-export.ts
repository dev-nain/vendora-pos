import { open, rm } from "node:fs/promises";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { CatalogExportResult } from "../../shared/products";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { categories, productBarcodes, products, taxCategories } from "../db/schema";
import { catalogCsvHeader, catalogCsvLine, type CatalogCsvRecord } from "./catalog-csv";

const CHUNK_ROWS = 1000;

export function readCatalogRecords(database: VendoraDatabase, storeId: string): CatalogCsvRecord[] {
  const rows = database.db
    .select({
      nameEn: products.nameEn,
      nameUr: products.nameUr,
      barcode: productBarcodes.barcode,
      packQtyMilli: productBarcodes.packQtyMilli,
      packPricePaisa: productBarcodes.salePricePaisa,
      categoryName: categories.name,
      unit: products.unit,
      costPaisa: products.costPaisa,
      salePricePaisa: products.salePricePaisa,
      mrpPaisa: products.mrpPaisa,
      taxCategoryName: taxCategories.name,
      internalCode: products.internalCode,
      brand: products.brand,
      pctCode: products.pctCode,
      lowStockThresholdMilli: products.lowStockThresholdMilli,
      isActive: products.isActive,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(taxCategories, eq(taxCategories.id, products.taxCategoryId))
    .leftJoin(
      productBarcodes,
      and(eq(productBarcodes.productId, products.id), isNull(productBarcodes.deletedAt)),
    )
    .where(
      and(eq(products.storeId, storeId), isNull(products.deletedAt), eq(products.isSystem, false)),
    )
    .orderBy(
      sql`lower(${products.nameEn})`,
      asc(products.id),
      asc(productBarcodes.packQtyMilli),
      asc(productBarcodes.barcode),
    )
    .all();
  return rows;
}

export async function writeCatalogCsv(
  database: VendoraDatabase,
  storeId: string,
  filePath: string,
): Promise<number> {
  const records = readCatalogRecords(database, storeId);
  const handle = await open(filePath, "w");
  try {
    await handle.write(`\uFEFF${catalogCsvHeader}`);
    for (let start = 0; start < records.length; start += CHUNK_ROWS) {
      const chunk = records
        .slice(start, start + CHUNK_ROWS)
        .map(catalogCsvLine)
        .join("");
      await handle.write(chunk);
    }
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(filePath, { force: true });
    throw error;
  }
  return records.length;
}

function localDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

interface CatalogExportDeps {
  database: VendoraDatabase;
  sessions: SessionStore;
  chooseSavePath: (defaultFileName: string) => Promise<string | null>;
  now?: () => Date;
}

export function createCatalogExportService({
  database,
  sessions,
  chooseSavePath,
  now = () => new Date(),
}: CatalogExportDeps) {
  return {
    async exportCsv(): Promise<CatalogExportResult> {
      requireSession(sessions);
      const path = await chooseSavePath(`vendora-catalog-${localDate(now())}.csv`);
      if (path === null) return { status: "cancelled" };
      const session = requireSession(sessions);
      await writeCatalogCsv(database, session.storeId, path);
      return { status: "saved", path };
    },
  };
}

export type CatalogExportService = ReturnType<typeof createCatalogExportService>;
