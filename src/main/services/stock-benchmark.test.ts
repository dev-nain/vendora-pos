import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VendoraDatabase } from "../db/client";
import { categories, stores, taxCategories, terminals, users } from "../db/schema";
import { createSessionStore } from "../auth/session";
import { seedStoreAndTerminal } from "../db/seed";
import { createAuditService } from "./audit";
import { createInventoryService } from "./inventory";
import { createStockService } from "./stock";
import { openMigratedDatabase } from "../db/test-database";
import {
  lowStockResultSchema,
  stockHistoryResultSchema,
  stockListResultSchema,
} from "../../shared/inventory";

const productCount = 30_000;
const movementCount = 1_000_000;
const hotMovements = 10_000;
const lowThresholdMilli = 5000;

const productId = (i: number) => `00000000-0000-7000-8000-${String(i).padStart(12, "0")}`;

const itemIndex = (item: { nameEn: string }) => Number(item.nameEn.slice("Item ".length));

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;

const measure = (label: string, runs: number, run: (n: number) => void) => {
  const durations: number[] = [];
  for (let n = 0; n < runs; n++) {
    const start = performance.now();
    run(n);
    durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  const p50 = percentile(durations, 0.5);
  const p95 = percentile(durations, 0.95);
  const max = durations.at(-1)!;
  console.log(
    `${label}: p50 ${p50.toFixed(3)} ms / p95 ${p95.toFixed(3)} ms / max ${max.toFixed(3)} ms`,
  );
  return p95;
};

describe("stock on-hand benchmark", () => {
  let dir: string;
  let database: VendoraDatabase;
  let service: ReturnType<typeof createStockService>;
  let inventory: ReturnType<typeof createInventoryService>;
  let secondCategoryId: string;
  const productIds: string[] = [];
  const totals = new Float64Array(productCount);

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-stock-bench-"));
    database = openMigratedDatabase(join(dir, "test.db"));
    seedStoreAndTerminal(database);
    const storeId = database.db.select().from(stores).get()!.id;
    const terminalId = database.db.select().from(terminals).get()!.id;
    const categoryId = database.db.select().from(categories).get()!.id;
    const taxCategoryId = database.db.select().from(taxCategories).get()!.id;
    const secondCategory = database.db
      .insert(categories)
      .values({ storeId, name: "Bench second" })
      .returning()
      .get().id;
    secondCategoryId = secondCategory;
    const actorId = database.db
      .insert(users)
      .values({ username: "owner", displayName: "Owner", passwordHash: "x", pinHash: "x" })
      .returning()
      .get().id;

    const base = Date.now();
    for (let i = 0; i < productCount; i++) productIds.push(productId(i));
    for (let m = 0; m < movementCount; m++) {
      const index = m < hotMovements ? 0 : (m - hotMovements) % productCount;
      totals[index]! += (m % 3 !== 0 ? 1 : -1) * (1000 + (m % 7) * 250);
    }

    database.sqlite.transaction(() => {
      database.sqlite
        .prepare(
          `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < @count - 1)
           INSERT INTO products (id, store_id, name_en, search_text, category_id, tax_category_id, unit, cost_paisa, sale_price_paisa, low_stock_threshold_milli, created_at, updated_at)
           SELECT printf('00000000-0000-7000-8000-%012d', i), @storeId, 'Item ' || i, 'item ' || i,
                  CASE WHEN i % 2 = 0 THEN @categoryId ELSE @secondCategoryId END,
                  @taxCategoryId, 'piece', 1000 + i, 1500 + i, @threshold, @base, @base
           FROM n`,
        )
        .run({
          count: productCount,
          storeId,
          categoryId,
          secondCategoryId: secondCategory,
          taxCategoryId,
          threshold: lowThresholdMilli,
          base,
        });
      database.sqlite
        .prepare(
          `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < @count - 1)
           INSERT INTO product_barcodes (id, store_id, product_id, barcode, created_at, updated_at)
           SELECT printf('00000000-0000-7000-a000-%012d', i), @storeId,
                  printf('00000000-0000-7000-8000-%012d', i), printf('89%011d', i), @base, @base
           FROM n`,
        )
        .run({ count: productCount, storeId, base });
      database.sqlite
        .prepare(
          `WITH RECURSIVE n(m) AS (SELECT 0 UNION ALL SELECT m + 1 FROM n WHERE m < @count - 1)
           INSERT INTO stock_movements (id, store_id, terminal_id, product_id, type, qty_milli, unit_cost_paisa, actor_user_id, created_at)
           SELECT printf('00000000-0000-7000-9000-%012d', m), @storeId, @terminalId,
                  printf('00000000-0000-7000-8000-%012d', CASE WHEN m < @hot THEN 0 ELSE (m - @hot) % @products END),
                  CASE WHEN m % 3 != 0 THEN 'receipt' ELSE 'sale' END,
                  (CASE WHEN m % 3 != 0 THEN 1 ELSE -1 END) * (1000 + (m % 7) * 250),
                  1000 + (m % 500), @actorId, @base + m
           FROM n`,
        )
        .run({
          count: movementCount,
          hot: hotMovements,
          products: productCount,
          storeId,
          terminalId,
          actorId,
          base,
        });
    })();

    service = createStockService({ database, audit: createAuditService(database) });
    const sessions = createSessionStore();
    sessions.start({ userId: actorId, storeId, loggedInAt: new Date(0) });
    inventory = createInventoryService({ database, sessions, stock: service });
  }, 180_000);

  afterAll(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads match the seeded totals", () => {
    for (const index of [0, 1, 12_345, productCount - 1]) {
      expect(service.onHand(productIds[index]!)).toBe(totals[index]);
    }
    expect(service.onHand(productIds[0]!)).not.toBe(0);
  });

  it("looks up on-hand for one product quickly", () => {
    const p95 = measure("onHand", 1000, (n) => {
      service.onHand(productIds[(n * 7919) % productCount]!);
    });
    expect(p95).toBeLessThan(10);
  });

  it("looks up on-hand for a 50-product bill quickly", () => {
    const p95 = measure("onHandMany(50)", 1000, (n) => {
      const ids = Array.from(
        { length: 50 },
        (_, k) => productIds[(n * 7919 + k * 613) % productCount]!,
      );
      expect(service.onHandMany(ids).size).toBe(50);
    });
    expect(p95).toBeLessThan(50);
  });

  it("looks up on-hand for the hot product quickly", () => {
    const p95 = measure("onHand hot (10,000+ movements)", 200, () => {
      service.onHand(productIds[0]!);
    });
    expect(p95).toBeLessThan(50);
  });

  const listStock = (query: string, offset = 0, categoryId?: string) =>
    stockListResultSchema.parse(
      inventory.list({ query, limit: 50, offset, ...(categoryId ? { categoryId } : {}) }),
    );
  const stockHistory = (index: number, offset = 0) =>
    stockHistoryResultSchema.parse(
      inventory.history({ productId: productIds[index]!, limit: 50, offset }),
    );

  it("lists stock with values that match the ledger", () => {
    const page = listStock("");
    expect(page.total).toBe(productCount);
    for (const item of page.items) {
      const index = Number(item.nameEn.slice("Item ".length));
      expect(item.onHandMilli).toBe(totals[index]);
      expect(item.costPaisa).toBe(1000 + index);
    }
  });

  it("opens the first stock list page quickly (cold)", () => {
    const start = performance.now();
    listStock("");
    const cold = performance.now() - start;
    console.log(`stock list first call (cold): ${cold.toFixed(3)} ms`);
  });

  it("lists the first page quickly", () => {
    expect(measure("stock list first page", 200, () => listStock(""))).toBeLessThan(100);
  });

  it("lists the first page of a category quickly", () => {
    const p95 = measure("stock list by category", 200, () => {
      expect(listStock("", 0, secondCategoryId).total).toBe(productCount / 2);
    });
    expect(p95).toBeLessThan(100);
  });

  it("lists a text query quickly", () => {
    const p95 = measure("stock list text query", 200, (n) => {
      expect(listStock(`item 1${n % 10}`).items.length).toBeGreaterThan(0);
    });
    expect(p95).toBeLessThan(100);
  });

  it("finds a product by barcode quickly", () => {
    const p95 = measure("stock list barcode", 200, (n) => {
      const index = (n * 7919) % productCount;
      expect(listStock(`89${String(index).padStart(11, "0")}`).items[0]?.id).toBe(
        productIds[index],
      );
    });
    expect(p95).toBeLessThan(100);
  });

  it("lists the last page quickly", () => {
    const p95 = measure("stock list last page", 200, () => {
      expect(listStock("", productCount - 50).items).toHaveLength(50);
    });
    expect(p95).toBeLessThan(100);
  });

  const lowIndexes = (parity?: number) =>
    Array.from({ length: productCount }, (_, i) => i).filter(
      (i) => totals[i]! <= lowThresholdMilli && (parity === undefined || i % 2 === parity),
    );
  const lowStock = (offset = 0, categoryId?: string) =>
    lowStockResultSchema.parse(
      inventory.lowStock({ limit: 50, offset, ...(categoryId ? { categoryId } : {}) }),
    );

  it("lists low stock that matches the ledger", () => {
    const expected = lowIndexes();
    expect(expected.length).toBeGreaterThan(50);

    const first = lowStock();
    expect(first.total).toBe(expected.length);
    for (const item of first.items) {
      const index = itemIndex(item);
      expect(item.onHandMilli).toBe(totals[index]);
      expect(item.shortfallMilli).toBe(lowThresholdMilli - totals[index]!);
    }

    const secondOnly = lowStock(0, secondCategoryId);
    expect(secondOnly.total).toBe(lowIndexes(1).length);
    expect(secondOnly.items.every((item) => itemIndex(item) % 2 === 1)).toBe(true);

    const lastOffset = Math.floor((expected.length - 1) / 50) * 50;
    expect(lowStock(lastOffset).items).toHaveLength(expected.length - lastOffset);
  });

  it("opens the low-stock list quickly (cold)", () => {
    const start = performance.now();
    lowStock();
    console.log(`low stock first call (cold): ${(performance.now() - start).toFixed(3)} ms`);
  });

  it("lists low stock within the report budget", () => {
    expect(measure("low stock list", 20, () => lowStock())).toBeLessThan(3000);
  });

  it("opens a normal product history page quickly", () => {
    const p95 = measure("stock history normal product", 200, (n) => {
      const result = stockHistory(1 + (n % 1000));
      expect(result.ok && result.movements.length).toBeGreaterThan(0);
    });
    expect(p95).toBeLessThan(100);
  });

  it("opens the first and last history pages of the hot product quickly", () => {
    const first = measure("stock history hot first page", 200, () => {
      const result = stockHistory(0);
      expect(result.ok && result.hasMore).toBe(true);
    });
    const last = measure("stock history hot last page", 200, () => {
      const result = stockHistory(0, hotMovements - 50 + 1);
      expect(result.ok && result.movements.length).toBeGreaterThan(0);
    });
    expect(first).toBeLessThan(100);
    expect(last).toBeLessThan(100);
  });
}, 180_000);
