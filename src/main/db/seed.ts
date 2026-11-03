import { and, asc, eq, sql } from "drizzle-orm";
import type { VendoraDatabase } from "./client";
import { normalizeSearchText } from "../services/search-text";
import { categories, products, stores, taxCategories, terminals } from "./schema";

type Tx = Parameters<Parameters<VendoraDatabase["db"]["transaction"]>[0]>[0];

// Soft-deleted defaults count as present so an Owner's deletion sticks.
function seedCatalogDefaults(tx: Tx, storeId: string): void {
  const hasCategory = (name: string) =>
    tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.storeId, storeId), sql`lower(${categories.name}) = lower(${name})`))
      .get();
  const hasTaxCategory = (name: string) =>
    tx
      .select({ id: taxCategories.id })
      .from(taxCategories)
      .where(
        and(eq(taxCategories.storeId, storeId), sql`lower(${taxCategories.name}) = lower(${name})`),
      )
      .get();

  if (!hasCategory("General")) {
    tx.insert(categories).values({ storeId, name: "General" }).run();
  }
  if (!hasTaxCategory("Standard")) {
    tx.insert(taxCategories).values({ storeId, name: "Standard", rateBps: null }).run();
  }
  if (!hasTaxCategory("Exempt")) {
    tx.insert(taxCategories).values({ storeId, name: "Exempt", rateBps: 0 }).run();
  }
}

function seedMiscItem(tx: Tx, storeId: string): void {
  const exists = tx
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.isSystem, true)))
    .get();
  if (exists) return;

  const category = tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.storeId, storeId), sql`lower(${categories.name}) = 'general'`))
    .get();
  const taxCategory = tx
    .select({ id: taxCategories.id })
    .from(taxCategories)
    .where(and(eq(taxCategories.storeId, storeId), sql`lower(${taxCategories.name}) = 'standard'`))
    .get();
  if (!category || !taxCategory) return;

  tx.insert(products)
    .values({
      storeId,
      nameEn: "Misc item",
      searchText: normalizeSearchText("Misc item"),
      categoryId: category.id,
      taxCategoryId: taxCategory.id,
      unit: "piece",
      costPaisa: 0,
      salePricePaisa: 0,
      isSystem: true,
    })
    .run();
}

export function seedStoreAndTerminal(database: VendoraDatabase): void {
  database.db.transaction((tx) => {
    const store = tx.select().from(stores).orderBy(asc(stores.id)).limit(1).get();
    const storeId = store?.id ?? tx.insert(stores).values({}).returning({ id: stores.id }).get().id;

    if (!tx.select({ id: terminals.id }).from(terminals).limit(1).get()) {
      tx.insert(terminals).values({ storeId, code: "T1" }).run();
    }

    seedCatalogDefaults(tx, storeId);
    seedMiscItem(tx, storeId);
  });
}
