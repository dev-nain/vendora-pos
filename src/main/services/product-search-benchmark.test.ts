import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VendoraDatabase } from "../db/client";
import { uuidv7 } from "../db/id";
import { categories, stores, taxCategories, terminals, users } from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import type { ProductSearchInput } from "../../shared/products";
import { searchProducts } from "./product-search";
import { normalizeSearchText } from "./search-text";
import { openMigratedDatabase } from "../db/test-database";

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
    database = openMigratedDatabase(join(dir, "vendora.db"));
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
