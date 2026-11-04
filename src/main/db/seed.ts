import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { VendoraDatabase } from "./client";
import { normalizeSearchText } from "../services/search-text";
import {
  cashDenominations,
  categories,
  products,
  stores,
  taxCategories,
  terminals,
} from "./schema";

type Tx = Parameters<Parameters<VendoraDatabase["db"]["transaction"]>[0]>[0];

// Defaults are keyed by is_system so renames stick; a soft-deleted default is adopted, not re-seeded.
function seedCatalogDefaults(tx: Tx, storeId: string): void {
  const inStore = eq(categories.storeId, storeId);
  const taxInStore = eq(taxCategories.storeId, storeId);

  const hasSystemCategory = tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(inStore, eq(categories.isSystem, true)))
    .get();
  if (!hasSystemCategory) {
    const adoptable = tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(inStore, sql`lower(${categories.name}) = 'general'`))
      .orderBy(asc(sql`${categories.deletedAt} IS NOT NULL`), asc(categories.id))
      .get();
    if (adoptable) {
      tx.update(categories).set({ isSystem: true }).where(eq(categories.id, adoptable.id)).run();
    } else {
      tx.insert(categories).values({ storeId, name: "General", isSystem: true }).run();
    }
  }

  const defaults = [
    { name: "Standard", rateBps: null, rateMatch: isNull(taxCategories.rateBps) },
    { name: "Exempt", rateBps: 0, rateMatch: eq(taxCategories.rateBps, 0) },
  ] as const;
  for (const { name, rateBps, rateMatch } of defaults) {
    const present = tx
      .select({ id: taxCategories.id })
      .from(taxCategories)
      .where(and(taxInStore, eq(taxCategories.isSystem, true), rateMatch))
      .get();
    if (present) continue;
    const adoptable = tx
      .select({ id: taxCategories.id })
      .from(taxCategories)
      .where(and(taxInStore, sql`lower(${taxCategories.name}) = ${name.toLowerCase()}`, rateMatch))
      .orderBy(asc(sql`${taxCategories.deletedAt} IS NOT NULL`), asc(taxCategories.id))
      .get();
    if (adoptable) {
      tx.update(taxCategories)
        .set({ isSystem: true })
        .where(eq(taxCategories.id, adoptable.id))
        .run();
    } else {
      tx.insert(taxCategories).values({ storeId, name, rateBps, isSystem: true }).run();
    }
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
    .where(and(eq(categories.storeId, storeId), eq(categories.isSystem, true)))
    .get();
  const taxCategory = tx
    .select({ id: taxCategories.id })
    .from(taxCategories)
    .where(
      and(
        eq(taxCategories.storeId, storeId),
        eq(taxCategories.isSystem, true),
        isNull(taxCategories.rateBps),
      ),
    )
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

const defaultDenominations = [
  { valuePaisa: 500000, kind: "note" },
  { valuePaisa: 100000, kind: "note" },
  { valuePaisa: 50000, kind: "note" },
  { valuePaisa: 10000, kind: "note" },
  { valuePaisa: 5000, kind: "note" },
  { valuePaisa: 2000, kind: "note" },
  { valuePaisa: 1000, kind: "note" },
  { valuePaisa: 500, kind: "coin" },
  { valuePaisa: 200, kind: "coin" },
  { valuePaisa: 100, kind: "coin" },
] as const;

// Any existing row, deleted or not, means the list was set up already; later edits stick.
function seedCashDenominations(tx: Tx, storeId: string): void {
  const exists = tx
    .select({ id: cashDenominations.id })
    .from(cashDenominations)
    .where(eq(cashDenominations.storeId, storeId))
    .get();
  if (exists) return;
  tx.insert(cashDenominations)
    .values(defaultDenominations.map((denomination) => ({ storeId, ...denomination })))
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
    seedCashDenominations(tx, storeId);
  });
}
