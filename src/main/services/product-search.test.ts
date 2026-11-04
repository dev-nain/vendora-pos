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
  stockMovements,
  stores,
  taxCategories,
  terminals,
  users,
} from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { PRODUCT_SEARCH_MAX_LIMIT, type ProductSearchInput } from "../../shared/products";
import { searchProducts } from "./product-search";
import { normalizeSearchText } from "./search-text";

describe("searchProducts", () => {
  let dir: string;
  let database: VendoraDatabase;
  let storeId: string;
  let categoryId: string;
  let taxCategoryId: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-product-search-"));
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, {
      migrationsFolder: join(process.cwd(), "drizzle"),
      backupDir: join(dir, "backups"),
    });
    seedStoreAndTerminal(database);
    storeId = database.db.select().from(stores).get()!.id;
    categoryId = database.db.select().from(categories).get()!.id;
    taxCategoryId = database.db.select().from(taxCategories).get()!.id;
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const addProduct = (overrides: Partial<typeof products.$inferInsert> & { nameEn: string }) => {
    const values = {
      storeId,
      categoryId,
      taxCategoryId,
      unit: "piece" as const,
      costPaisa: 100,
      salePricePaisa: 150,
      ...overrides,
    };
    return database.db
      .insert(products)
      .values({
        ...values,
        searchText: normalizeSearchText(values.nameEn, values.nameUr, values.internalCode),
      })
      .returning()
      .get();
  };

  const addBarcode = (
    productId: string,
    barcode: string,
    overrides: Partial<typeof productBarcodes.$inferInsert> = {},
  ) =>
    database.db
      .insert(productBarcodes)
      .values({ storeId, productId, barcode, ...overrides })
      .run();

  const search = (query: string, extra: Partial<ProductSearchInput> = {}) =>
    searchProducts(database, storeId, { query, limit: 100, offset: 0, ...extra });

  const names = (query: string, extra: Partial<ProductSearchInput> = {}) =>
    search(query, extra).items.map((item) => item.nameEn);

  const addCategory = (name: string, forStore = storeId) =>
    database.db.insert(categories).values({ storeId: forStore, name }).returning().get();

  it("matches English partials case-insensitively", () => {
    addProduct({ nameEn: "Tapal Danedar" });
    expect(names("dane")).toEqual(["Tapal Danedar"]);
    expect(names("TAP")).toEqual(["Tapal Danedar"]);
    expect(names("tapx")).toEqual([]);
  });

  it("normalises the query like the stored text", () => {
    addProduct({ nameEn: "Tea Bag" });
    expect(names("  TEA   Bag ")).toEqual(["Tea Bag"]);
  });

  it("matches Urdu partials", () => {
    addProduct({ nameEn: "Tapal Danedar", nameUr: "ٹپال دانے دار" });
    expect(names("دانے")).toEqual(["Tapal Danedar"]);
    expect(names("ٹپا")).toEqual(["Tapal Danedar"]);
  });

  it("matches internal code", () => {
    addProduct({ nameEn: "Tapal Danedar", internalCode: "TD-950" });
    expect(names("td-9")).toEqual(["Tapal Danedar"]);
    expect(names("TD-950")).toEqual(["Tapal Danedar"]);
  });

  describe("barcodes", () => {
    it("returns the exact barcode match first", () => {
      const zinger = addProduct({ nameEn: "Zinger Burger" });
      addBarcode(zinger.id, "8961000000017");
      addProduct({ nameEn: "Alpha", internalCode: "8961000000017-A" });
      addProduct({ nameEn: "Beta", internalCode: "8961000000017-B" });

      const result = search("8961000000017");
      expect(result.items[0]?.nameEn).toBe("Zinger Burger");
      expect(result.total).toBe(3);
    });

    it("ignores barcode fragments", () => {
      const zinger = addProduct({ nameEn: "Zinger Burger" });
      addBarcode(zinger.id, "8961000000017");
      addProduct({ nameEn: "Alpha", internalCode: "8961-A" });

      expect(names("8961")).toEqual(["Alpha"]);
      expect(names("000017")).toEqual([]);
    });

    it("ignores soft-deleted barcodes", () => {
      const zinger = addProduct({ nameEn: "Zinger Burger" });
      addBarcode(zinger.id, "8961000000017", { deletedAt: new Date() });
      expect(names("8961000000017")).toEqual([]);
    });

    it("ignores barcodes of another store", () => {
      const otherStore = database.db.insert(stores).values({}).returning().get();
      const otherCategory = addCategory("General", otherStore.id);
      const otherTax = database.db
        .insert(taxCategories)
        .values({ storeId: otherStore.id, name: "Standard" })
        .returning()
        .get();
      const other = addProduct({
        nameEn: "Zinger Burger",
        storeId: otherStore.id,
        categoryId: otherCategory.id,
        taxCategoryId: otherTax.id,
      });
      addBarcode(other.id, "8961000000017", { storeId: otherStore.id });
      expect(names("8961000000017")).toEqual([]);
    });

    it("returns and counts a barcode product once when its text also matches", () => {
      const product = addProduct({ nameEn: "Item 8961000000017" });
      addBarcode(product.id, "8961000000017");

      const result = search("8961000000017");
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  it("ANDs multiple terms in any order", () => {
    addProduct({ nameEn: "Lipton Yellow Label" });
    addProduct({ nameEn: "Lipton Green Tea" });
    expect(names("lipton yellow")).toEqual(["Lipton Yellow Label"]);
    expect(names("yel lip")).toEqual(["Lipton Yellow Label"]);
    expect(names("lipton")).toEqual(["Lipton Green Tea", "Lipton Yellow Label"]);
  });

  it("filters by category", () => {
    const other = addCategory("Beverages");
    addProduct({ nameEn: "Cola" });
    addProduct({ nameEn: "Cola", categoryId: other.id });

    const result = search("cola", { categoryId: other.id });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.categoryId).toBe(other.id);
    expect(result.total).toBe(1);
  });

  it("includes archived products only when asked", () => {
    addProduct({ nameEn: "Soap Active" });
    addProduct({ nameEn: "Soap Old", isActive: false });

    expect(names("soap")).toEqual(["Soap Active"]);
    const result = search("soap", { includeArchived: true });
    expect(result.items.map((item) => [item.nameEn, item.isActive])).toEqual([
      ["Soap Active", true],
      ["Soap Old", false],
    ]);
  });

  it("never returns deleted or system products", () => {
    addProduct({ nameEn: "Soap Visible" });
    addProduct({ nameEn: "Soap Deleted", deletedAt: new Date() });
    addProduct({ nameEn: "Soap System", isSystem: true });

    expect(names("soap")).toEqual(["Soap Visible"]);
    expect(names("soap", { includeArchived: true })).toEqual(["Soap Visible"]);
  });

  it("never returns products of another store", () => {
    const otherStore = database.db.insert(stores).values({}).returning().get();
    const otherCategory = addCategory("General", otherStore.id);
    const otherTax = database.db
      .insert(taxCategories)
      .values({ storeId: otherStore.id, name: "Standard" })
      .returning()
      .get();
    addProduct({
      nameEn: "Soap Elsewhere",
      storeId: otherStore.id,
      categoryId: otherCategory.id,
      taxCategoryId: otherTax.id,
    });
    expect(names("soap")).toEqual([]);
  });

  it("treats wildcard characters literally", () => {
    addProduct({ nameEn: "100% Juice" });
    addProduct({ nameEn: "Juice 100" });
    addProduct({ nameEn: "a_b soap" });
    addProduct({ nameEn: "axb soap" });
    addProduct({ nameEn: "back\\slash" });

    expect(names("100%")).toEqual(["100% Juice"]);
    expect(names("a_b")).toEqual(["a_b soap"]);
    expect(names("%")).toEqual(["100% Juice"]);
    expect(names("_")).toEqual(["a_b soap"]);
    expect(names("\\")).toEqual(["back\\slash"]);
  });

  it("sorts by name case-insensitively and pages without gaps", () => {
    addProduct({ nameEn: "banana" });
    addProduct({ nameEn: "Apple" });
    addProduct({ nameEn: "cherry" });

    expect(names("")).toEqual(["Apple", "banana", "cherry"]);

    const first = search("", { limit: 2, offset: 0 });
    const second = search("", { limit: 2, offset: 2 });
    expect([...first.items, ...second.items].map((item) => item.nameEn)).toEqual([
      "Apple",
      "banana",
      "cherry",
    ]);
    expect(first.total).toBe(3);
    expect(second.total).toBe(3);
  });

  it("clamps limit and offset", () => {
    database.sqlite.transaction(() => {
      for (let i = 0; i < 120; i++) addProduct({ nameEn: `Item ${String(i).padStart(3, "0")}` });
    })();

    const big = search("item", { limit: 500 });
    expect(big.items).toHaveLength(PRODUCT_SEARCH_MAX_LIMIT);
    expect(big.total).toBe(120);
    expect(search("item", { limit: 0 }).items).toHaveLength(1);
    expect(search("item", { limit: 3, offset: -5 }).items).toEqual(
      search("item", { limit: 3, offset: 0 }).items,
    );
  });

  describe("barcode summary", () => {
    it("prefers a base barcode added after a pack barcode", () => {
      const product = addProduct({ nameEn: "Milk" });
      addBarcode(product.id, "8961000000100", { packQtyMilli: 12000, createdAt: at(0) });
      addBarcode(product.id, "8961000000001", { packQtyMilli: 1000, createdAt: at(10) });
      expect(search("").items[0]!).toMatchObject({
        primaryBarcode: "8961000000001",
        extraBarcodeCount: 1,
      });
    });

    it("takes the earlier of two base barcodes", () => {
      const product = addProduct({ nameEn: "Milk" });
      addBarcode(product.id, "8961000000002", { createdAt: at(10) });
      addBarcode(product.id, "8961000000001", { createdAt: at(0) });
      expect(search("").items[0]!.primaryBarcode).toBe("8961000000001");
    });

    it("falls back to the earliest pack barcode", () => {
      const product = addProduct({ nameEn: "Milk" });
      addBarcode(product.id, "8961000000012", { packQtyMilli: 24000, createdAt: at(10) });
      addBarcode(product.id, "8961000000011", { packQtyMilli: 12000, createdAt: at(0) });
      expect(search("").items[0]!).toMatchObject({
        primaryBarcode: "8961000000011",
        extraBarcodeCount: 1,
      });
    });

    it("reports no barcode", () => {
      addProduct({ nameEn: "Milk" });
      expect(search("").items[0]!).toMatchObject({ primaryBarcode: null, extraBarcodeCount: 0 });
    });

    it("ignores a soft-deleted base barcode", () => {
      const product = addProduct({ nameEn: "Milk" });
      addBarcode(product.id, "8961000000001", { createdAt: at(0), deletedAt: new Date() });
      addBarcode(product.id, "8961000000100", { packQtyMilli: 12000, createdAt: at(10) });
      expect(search("").items[0]!).toMatchObject({
        primaryBarcode: "8961000000100",
        extraBarcodeCount: 0,
      });
    });

    it("counts every other live barcode", () => {
      const product = addProduct({ nameEn: "Milk" });
      addBarcode(product.id, "8961000000001", { createdAt: at(0) });
      addBarcode(product.id, "8961000000002", { packQtyMilli: 12000, createdAt: at(1) });
      addBarcode(product.id, "8961000000003", { packQtyMilli: 24000, createdAt: at(2) });
      expect(search("").items[0]!.extraBarcodeCount).toBe(2);
    });

    it("carries the fields on an exact barcode match ranked first", () => {
      const zinger = addProduct({ nameEn: "Zinger Burger" });
      addBarcode(zinger.id, "8961000000017", { createdAt: at(0) });
      addBarcode(zinger.id, "8961000000024", { packQtyMilli: 12000, createdAt: at(1) });
      addProduct({ nameEn: "Alpha", internalCode: "8961000000017-A" });

      const [top, second] = search("8961000000017").items;
      expect(top).toMatchObject({
        nameEn: "Zinger Burger",
        primaryBarcode: "8961000000017",
        extraBarcodeCount: 1,
      });
      expect(second).toMatchObject({ primaryBarcode: null, extraBarcodeCount: 0 });
    });
  });

  it("returns stock on hand as the sum of the product's movements", () => {
    const tea = addProduct({ nameEn: "Tea" });
    const rice = addProduct({ nameEn: "Rice", unit: "kg" });
    addProduct({ nameEn: "Unstocked" });
    const terminalId = database.db.select().from(terminals).get()!.id;
    const actorUserId = database.db
      .insert(users)
      .values({ username: "owner", displayName: "Owner", passwordHash: "x", pinHash: "x" })
      .returning()
      .get().id;
    const move = (productId: string, type: "receipt" | "sale", qtyMilli: number) =>
      database.db
        .insert(stockMovements)
        .values({ storeId, terminalId, productId, type, qtyMilli, unitCostPaisa: 100, actorUserId })
        .run();
    move(tea.id, "receipt", 12_000);
    move(tea.id, "sale", -2_000);
    move(rice.id, "receipt", 1_250);

    const onHand = Object.fromEntries(
      search("").items.map((item) => [item.nameEn, item.onHandMilli]),
    );

    expect(onHand).toEqual({ Rice: 1_250, Tea: 10_000, Unstocked: 0 });
    expect(search("").total).toBe(3);
  });

  it("treats a whitespace query as empty", () => {
    addProduct({ nameEn: "Banana" });
    addProduct({ nameEn: "Apple" });
    expect(names("   ")).toEqual(["Apple", "Banana"]);
  });
});

const at = (ms: number) => new Date(1_700_000_000_000 + ms);

const barcodeOf = (i: number) => `896${String(i).padStart(10, "0")}`;

const packBarcodeOf = (i: number) => `897${String(i).padStart(10, "0")}`;

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]!;

describe("searchProducts benchmark", () => {
  const brands = [
    "Tapal",
    "Lipton",
    "Nestle",
    "Shan",
    "National",
    "Dalda",
    "Surf",
    "Lux",
    "Peek Freans",
    "Olpers",
  ];
  const items = ["Tea", "Milk", "Biscuit", "Masala", "Oil", "Soap", "Shampoo", "Rice", "Sugar"];
  const sizes = ["250g", "500g", "1kg", "1L", "2kg", "100g"];
  const urduWords = ["چائے", "دودھ", "بسکٹ", "مصالحہ", "تیل", "صابن"];
  const total = 30_000;
  const barcodeIndex = 12_345;

  let dir: string;
  let database: VendoraDatabase;
  let storeId: string;
  let barcodeProductId: string;
  let categoryIds: string[];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-product-search-bench-"));
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, {
      migrationsFolder: join(process.cwd(), "drizzle"),
      backupDir: join(dir, "backups"),
    });
    seedStoreAndTerminal(database);
    storeId = database.db.select().from(stores).get()!.id;
    const terminalId = database.db.select().from(terminals).get()!.id;
    const actorId = database.db
      .insert(users)
      .values({ username: "owner", displayName: "Owner", passwordHash: "x", pinHash: "x" })
      .returning()
      .get().id;
    const generalId = database.db.select().from(categories).get()!.id;
    const taxCategoryId = database.db.select().from(taxCategories).get()!.id;
    categoryIds = [generalId];
    for (const name of ["Grocery", "Beverages", "Household"]) {
      categoryIds.push(
        database.db.insert(categories).values({ storeId, name }).returning().get().id,
      );
    }

    const insertProduct = database.sqlite.prepare(
      `INSERT INTO products (id, store_id, name_en, name_ur, search_text, category_id, tax_category_id, unit, internal_code, cost_paisa, sale_price_paisa, is_active, is_system, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'piece', ?, 100, 150, ?, 0, ?, ?)`,
    );
    const insertBarcode = database.sqlite.prepare(
      `INSERT INTO product_barcodes (id, store_id, product_id, barcode, pack_qty_milli, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertMovement = database.sqlite.prepare(
      `INSERT INTO stock_movements (id, store_id, terminal_id, product_id, type, qty_milli, unit_cost_paisa, actor_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 100, ?, ?)`,
    );
    const now = Date.now();
    database.sqlite.transaction(() => {
      for (let i = 0; i < total; i++) {
        const brand = brands[i % brands.length]!;
        const item = items[Math.floor(i / brands.length) % items.length]!;
        const size = sizes[Math.floor(i / 100) % sizes.length]!;
        const nameEn = `${brand} ${item} ${size} ${i}`;
        const nameUr = i % 3 === 0 ? `${urduWords[i % urduWords.length]} ${brand}` : null;
        const code = `C${i}`;
        const productId = uuidv7();
        if (i === barcodeIndex) barcodeProductId = productId;
        insertProduct.run(
          productId,
          storeId,
          nameEn,
          nameUr,
          normalizeSearchText(nameEn, nameUr, code),
          categoryIds[i % categoryIds.length],
          taxCategoryId,
          code,
          i % 20 === 0 ? 0 : 1,
          now,
          now,
        );
        insertMovement.run(
          uuidv7(),
          storeId,
          terminalId,
          productId,
          "receipt",
          10_000,
          actorId,
          now,
        );
        insertMovement.run(uuidv7(), storeId, terminalId, productId, "sale", -2_000, actorId, now);
        if (i % 10 === 0) {
          insertBarcode.run(uuidv7(), storeId, productId, packBarcodeOf(i), 12000, now - 1, now);
        }
        insertBarcode.run(uuidv7(), storeId, productId, barcodeOf(i), 1000, now, now);
      }
    })();
  }, 60_000);

  afterAll(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const measure = (group: string, queries: string[], categoryFilter?: string[]) => {
    const durations: number[] = [];
    const inputs: ProductSearchInput[] = categoryFilter
      ? categoryFilter.flatMap((categoryId) =>
          queries.map((query) => ({ query, categoryId, limit: 50, offset: 0 })),
        )
      : queries.map((query) => ({ query, limit: 50, offset: 0 }));
    for (const input of inputs) {
      for (let i = 0; i < 5; i++) {
        searchProducts(database, storeId, input);
      }
      for (let i = 0; i < 50; i++) {
        const start = performance.now();
        searchProducts(database, storeId, input);
        durations.push(performance.now() - start);
      }
    }
    durations.sort((a, b) => a - b);
    const p50 = percentile(durations, 0.5);
    const p95 = percentile(durations, 0.95);
    console.info(
      `product search ${group}: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${durations[durations.length - 1]!.toFixed(1)} ms`,
    );
    return p95;
  };

  it("returns correct results", () => {
    const tea = searchProducts(database, storeId, { query: "tea", limit: 50, offset: 0 });
    expect(tea.items).toHaveLength(50);
    expect(tea.total).toBeGreaterThan(50);
    for (const item of tea.items) expect(item.nameEn.toLowerCase()).toContain("tea");

    const byBarcode = searchProducts(database, storeId, {
      query: barcodeOf(barcodeIndex),
      includeArchived: true,
      limit: 50,
      offset: 0,
    });
    expect(byBarcode.items[0]?.id).toBe(barcodeProductId);
  });

  it("returns stock on hand for every result", () => {
    const tea = searchProducts(database, storeId, { query: "tea", limit: 50, offset: 0 });
    for (const item of tea.items) expect(item.onHandMilli).toBe(8_000);
  });

  it("returns barcode summaries", () => {
    const multi = searchProducts(database, storeId, {
      query: "C12340",
      includeArchived: true,
      limit: 50,
      offset: 0,
    });
    expect(multi.items[0]).toMatchObject({
      primaryBarcode: barcodeOf(12_340),
      extraBarcodeCount: 1,
    });
    const single = searchProducts(database, storeId, {
      query: barcodeOf(barcodeIndex),
      includeArchived: true,
      limit: 50,
      offset: 0,
    });
    expect(single.items[0]).toMatchObject({
      primaryBarcode: barcodeOf(barcodeIndex),
      extraBarcodeCount: 0,
    });
  });

  it("answers 3-character queries under 100 ms p95", { timeout: 60_000 }, () => {
    expect(measure("3-character", ["tea", "mil", "bis", "oil", "sha", "چائ"])).toBeLessThan(100);
  });

  it("answers full-word queries under 100 ms p95", { timeout: 60_000 }, () => {
    expect(measure("full-word", ["biscuit", "masala", "shampoo", "tapal", "دودھ"])).toBeLessThan(
      100,
    );
  });

  it("answers the empty query under 100 ms p95", { timeout: 60_000 }, () => {
    expect(measure("empty query", [""])).toBeLessThan(100);
    expect(measure("empty query by category", [""], categoryIds)).toBeLessThan(100);
  });
});
