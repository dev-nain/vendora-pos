import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { seedStoreAndTerminal } from "../db/seed";
import { openMigratedDatabase } from "../db/test-database";
import { categories, stores, taxCategories, terminals, users } from "../db/schema";
import { createAuditService } from "./audit";
import { createGoodsReceivedService } from "./goods-received";
import { createStockService } from "./stock";

const noteCount = 5_000;
const linesPerNote = 20;
const productCount = 500;

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
  const p95 = percentile(durations, 0.95);
  console.log(
    `${label}: p50 ${percentile(durations, 0.5).toFixed(3)} ms / p95 ${p95.toFixed(3)} ms / max ${durations.at(-1)!.toFixed(3)} ms`,
  );
  return p95;
};

describe("goods received reads benchmark", () => {
  let dir: string;
  let database: VendoraDatabase;
  let service: ReturnType<typeof createGoodsReceivedService>;
  const productIds: string[] = [];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-grn-bench-"));
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
    const base = Date.now() - noteCount * 1000;
    for (let i = 0; i < productCount; i++) {
      productIds.push(`00000000-0000-7000-8000-${String(i).padStart(12, "0")}`);
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
          `INSERT INTO suppliers (id, store_id, name, created_at, updated_at)
           VALUES ('00000000-0000-7000-b000-000000000001', @storeId, 'Bench supplier', @base, @base)`,
        )
        .run({ storeId, base });
      database.sqlite
        .prepare(
          `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < @count - 1)
           INSERT INTO goods_received_notes (id, store_id, terminal_id, grn_no, supplier_id, supplier_invoice_no, total_paisa, actor_user_id, created_at)
           SELECT printf('00000000-0000-7000-c000-%012d', i), @storeId, @terminalId,
                  printf('GRN-B-%06d', i), '00000000-0000-7000-b000-000000000001',
                  'INV-' || i, 100000, @actorId, @base + i * 1000
           FROM n`,
        )
        .run({ count: noteCount, storeId, terminalId, actorId, base });
      database.sqlite
        .prepare(
          `WITH RECURSIVE n(m) AS (SELECT 0 UNION ALL SELECT m + 1 FROM n WHERE m < @count - 1)
           INSERT INTO goods_received_lines (id, store_id, terminal_id, goods_received_note_id, position, product_id, name_en, unit, qty_milli, unit_cost_paisa, line_total_paisa, created_at)
           SELECT printf('00000000-0000-7000-d000-%012d', m), @storeId, @terminalId,
                  printf('00000000-0000-7000-c000-%012d', m / @perNote), m % @perNote,
                  printf('00000000-0000-7000-8000-%012d', (m * 7) % @products),
                  'Item', 'piece', 1000, 1000 + (m % 500), 1000 + (m % 500),
                  @base + (m / @perNote) * 1000
           FROM n`,
        )
        .run({
          count: noteCount * linesPerNote,
          perNote: linesPerNote,
          products: productCount,
          storeId,
          terminalId,
          base,
        });
    })();

    const sessions = createSessionStore();
    sessions.start({ userId: actorId, storeId, loggedInAt: new Date(0) });
    const audit = createAuditService(database);
    service = createGoodsReceivedService({
      database,
      audit,
      sessions,
      stock: createStockService({ database, audit }),
    });
  }, 180_000);

  afterAll(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads the newest cost for a product", () => {
    expect(service.lastCost({ productId: productIds[3]! }).unitCostPaisa).not.toBeNull();
  });

  it("looks up the last cost quickly", () => {
    const p95 = measure("lastCost", 1000, (n) => {
      service.lastCost({ productId: productIds[(n * 7919) % productCount]! });
    });
    expect(p95).toBeLessThan(10);
  });

  it("opens the first list page quickly", () => {
    const p95 = measure("list first page", 200, () => {
      const page = service.list({ limit: 50, offset: 0 });
      expect(page.total).toBe(noteCount);
      expect(page.items).toHaveLength(50);
    });
    expect(p95).toBeLessThan(100);
  });
});
