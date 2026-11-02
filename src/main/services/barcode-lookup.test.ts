import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type VendoraDatabase } from "../db/client";
import { runMigrations } from "../db/migrate";
import {
  categories,
  productBarcodes,
  products,
  stores,
  taxCategories,
  type ProductUnit,
} from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { lookupBarcode } from "./barcode-lookup";

describe("lookupBarcode", () => {
  let dir: string;
  let database: VendoraDatabase;
  let storeId: string;
  let categoryId: string;
  let taxCategoryId: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-barcode-"));
    database = openDatabase(join(dir, "test.db"));
    runMigrations(database, {
      migrationsFolder: join(process.cwd(), "drizzle"),
      backupDir: join(dir, "backups"),
    });
    seedStoreAndTerminal(database);
    storeId = database.db.select().from(stores).get()!.id;
    categoryId = database.db.select().from(categories).get()!.id;
    taxCategoryId = database.db
      .select()
      .from(taxCategories)
      .all()
      .find((t) => t.name === "Standard")!.id;
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const addProduct = (overrides: Partial<typeof products.$inferInsert> = {}) =>
    database.db
      .insert(products)
      .values({
        storeId,
        nameEn: "Tea",
        searchText: "tea",
        categoryId,
        taxCategoryId,
        unit: "piece" as ProductUnit,
        costPaisa: 10000,
        salePricePaisa: 12000,
        ...overrides,
      })
      .returning()
      .get();

  const addBarcode = (
    productId: string,
    barcode: string,
    overrides: Partial<typeof productBarcodes.$inferInsert> = {},
  ) =>
    database.db
      .insert(productBarcodes)
      .values({ storeId, productId, barcode, ...overrides })
      .returning()
      .get();

  it("returns a piece barcode as 1000 milli", () => {
    const product = addProduct({ nameUr: "چائے" });
    addBarcode(product.id, "8961000000017");

    expect(lookupBarcode(database, storeId, "8961000000017")).toEqual({
      product: {
        id: product.id,
        nameEn: "Tea",
        nameUr: "چائے",
        unit: "piece",
        salePricePaisa: 12000,
        taxCategoryId,
        costPaisa: 10000,
      },
      packQtyMilli: 1000,
      packPricePaisa: null,
    });
  });

  it("returns the pack quantity and own price for a pack barcode", () => {
    const product = addProduct();
    addBarcode(product.id, "8961000000017");
    addBarcode(product.id, "carton", { packQtyMilli: 24000, salePricePaisa: 270000 });

    const result = lookupBarcode(database, storeId, "carton");
    expect(result?.product.id).toBe(product.id);
    expect(result?.packQtyMilli).toBe(24000);
    expect(result?.packPricePaisa).toBe(270000);
  });

  it("returns a null pack price when the pack has no own price", () => {
    const product = addProduct();
    addBarcode(product.id, "dozen", { packQtyMilli: 12000 });

    const result = lookupBarcode(database, storeId, "dozen");
    expect(result?.packQtyMilli).toBe(12000);
    expect(result?.packPricePaisa).toBeNull();
  });

  it("returns null for an archived product", () => {
    const product = addProduct({ isActive: false });
    addBarcode(product.id, "A1");
    expect(lookupBarcode(database, storeId, "A1")).toBeNull();
  });

  it("returns null for a deleted product", () => {
    const product = addProduct({ deletedAt: new Date() });
    addBarcode(product.id, "A1");
    expect(lookupBarcode(database, storeId, "A1")).toBeNull();
  });

  it("returns null for a deleted barcode and finds it again on a new product", () => {
    const first = addProduct({ nameEn: "First" });
    addBarcode(first.id, "A1", { deletedAt: new Date() });
    expect(lookupBarcode(database, storeId, "A1")).toBeNull();

    const second = addProduct({ nameEn: "Second" });
    addBarcode(second.id, "A1");
    expect(lookupBarcode(database, storeId, "A1")?.product.id).toBe(second.id);
  });

  it("returns null for an unknown barcode", () => {
    addBarcode(addProduct().id, "A1");
    expect(lookupBarcode(database, storeId, "B2")).toBeNull();
  });

  it("does not match a barcode from another store", () => {
    const otherStoreId = database.db.insert(stores).values({}).returning().get().id;
    const otherCategoryId = database.db
      .insert(categories)
      .values({ storeId: otherStoreId, name: "General" })
      .returning()
      .get().id;
    const otherTaxId = database.db
      .insert(taxCategories)
      .values({ storeId: otherStoreId, name: "Standard" })
      .returning()
      .get().id;
    const product = addProduct({
      storeId: otherStoreId,
      categoryId: otherCategoryId,
      taxCategoryId: otherTaxId,
    });
    addBarcode(product.id, "X1", { storeId: otherStoreId });

    expect(lookupBarcode(database, storeId, "X1")).toBeNull();
    expect(lookupBarcode(database, otherStoreId, "X1")?.product.id).toBe(product.id);
  });

  it("trims scanner whitespace and rejects empty input", () => {
    addBarcode(addProduct().id, "8961000000017");

    expect(lookupBarcode(database, storeId, "  8961000000017\r\n")).not.toBeNull();
    expect(lookupBarcode(database, storeId, "\t8961000000017 ")).not.toBeNull();
    expect(lookupBarcode(database, storeId, "")).toBeNull();
    expect(lookupBarcode(database, storeId, "   ")).toBeNull();
  });

  it("matches exactly", () => {
    addBarcode(addProduct().id, "AB1234");

    expect(lookupBarcode(database, storeId, "AB123")).toBeNull();
    expect(lookupBarcode(database, storeId, "AB12345")).toBeNull();
    expect(lookupBarcode(database, storeId, "ab1234")).toBeNull();
  });

  it("round-trips a null Urdu name and a kg unit", () => {
    const product = addProduct({ nameUr: null, unit: "kg", salePricePaisa: 45050 });
    addBarcode(product.id, "KG1");

    const result = lookupBarcode(database, storeId, "KG1");
    expect(result?.product.nameUr).toBeNull();
    expect(result?.product.unit).toBe("kg");
    expect(result?.product.salePricePaisa).toBe(45050);
  });
});
