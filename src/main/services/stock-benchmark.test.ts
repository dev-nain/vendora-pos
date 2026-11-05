import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VendoraDatabase } from "../db/client";
import { categories, stores, taxCategories, terminals, users } from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { createAuditService } from "./audit";
import { createStockService } from "./stock";
import { openMigratedDatabase } from "../db/test-database";

const productCount = 30_000;
const movementCount = 1_000_000;
const hotMovements = 10_000;

const productId = (i: number) => `00000000-0000-7000-8000-${String(i).padStart(12, "0")}`;

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
           INSERT INTO products (id, store_id, name_en, search_text, category_id, tax_category_id, unit, cost_paisa, sale_price_paisa, created_at, updated_at)
           SELECT printf('00000000-0000-7000-8000-%012d', i), @storeId, 'Item ' || i, 'item ' || i,
                  @categoryId, @taxCategoryId, 'piece', 1000 + i, 1500 + i, @base, @base
           FROM n`,
        )
        .run({ count: productCount, storeId, categoryId, taxCategoryId, base });
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
}, 180_000);
