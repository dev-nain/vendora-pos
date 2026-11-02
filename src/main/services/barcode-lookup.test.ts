import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type VendoraDatabase } from "../db/client";
import { uuidv7 } from "../db/id";
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

const productCount = 30_000;
const packCount = 10_000;
const packSizes = [6000, 12000, 24000];
const pieceCode = (i: number) => String(8961000000000 + i);
const packCode = (i: number) => `P${i}`;
const codeAt = (n: number) => {
  const i = (n * 7919) % productCount;
  if (n % 3 === 0) return pieceCode(i);
  if (n % 3 === 1) return packCode(i % packCount);
  return `UNKNOWN${i}`;
};

describe("lookupBarcode benchmark", () => {
  let dir: string;
  let database: VendoraDatabase;
  let storeId: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-barcode-bench-"));
    database = openDatabase(join(dir, "test.db"));
    runMigrations(database, {
      migrationsFolder: join(process.cwd(), "drizzle"),
      backupDir: join(dir, "backups"),
    });
    seedStoreAndTerminal(database);
    storeId = database.db.select().from(stores).get()!.id;
    const categoryId = database.db.select().from(categories).get()!.id;
    const taxCategoryId = database.db.select().from(taxCategories).get()!.id;

    const insertProduct = database.sqlite.prepare(
      `INSERT INTO products (id, store_id, name_en, search_text, category_id, tax_category_id, unit, cost_paisa, sale_price_paisa, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'piece', ?, ?, ?, ?)`,
    );
    const insertBarcode = database.sqlite.prepare(
      `INSERT INTO product_barcodes (id, store_id, product_id, barcode, pack_qty_milli, sale_price_paisa, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    database.sqlite.transaction(() => {
      for (let i = 0; i < productCount; i++) {
        const productId = uuidv7();
        const name = `Item ${i}`;
        insertProduct.run(
          productId,
          storeId,
          name,
          name.toLowerCase(),
          categoryId,
          taxCategoryId,
          1000 + i,
          1500 + i,
          now,
          now,
        );
        insertBarcode.run(uuidv7(), storeId, productId, pieceCode(i), 1000, null, now, now);
        if (i < packCount) {
          insertBarcode.run(
            uuidv7(),
            storeId,
            productId,
            packCode(i),
            packSizes[i % 3]!,
            i % 2 === 0 ? 20000 + i : null,
            now,
            now,
          );
        }
      }
    })();
  }, 60_000);

  afterAll(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it(
    "looks up in well under the 100 ms scan budget at 30,000 products",
    {
      timeout: 60_000,
    },
    () => {
      for (let n = 0; n < 50; n++) lookupBarcode(database, storeId, codeAt(n));

      const durations: number[] = [];
      for (let n = 0; n < 1000; n++) {
        const code = codeAt(n);
        const start = performance.now();
        const result = lookupBarcode(database, storeId, code);
        durations.push(performance.now() - start);

        if (n % 3 === 1) {
          const i = ((n * 7919) % productCount) % packCount;
          expect(result?.packQtyMilli).toBe(packSizes[i % 3]);
        } else if (n % 3 === 2) {
          expect(result).toBeNull();
        } else {
          expect(result?.packQtyMilli).toBe(1000);
        }
      }

      durations.sort((a, b) => a - b);
      expect(durations[Math.floor(durations.length * 0.95)]!).toBeLessThan(10);
    },
  );
});
