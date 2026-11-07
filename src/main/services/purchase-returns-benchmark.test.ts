import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postPurchaseReturnInputSchema } from "../../shared/purchase-returns";
import { createSessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { seedStoreAndTerminal } from "../db/seed";
import { openMigratedDatabase } from "../db/test-database";
import { categories, stores, taxCategories, terminals, users } from "../db/schema";
import { createAuditService } from "./audit";
import { createPurchaseHistoryService } from "./purchase-history";
import { createPurchaseReturnsService } from "./purchase-returns";
import { createStockService } from "./stock";

const noteCount = 5_000;
const linesPerNote = 20;
const productCount = 500;
const supplierCount = 10;
const returnCount = 2_000;
const linesPerReturn = 5;

const supplierId = (i: number) => `00000000-0000-7000-b000-${String(i).padStart(12, "0")}`;
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
  const p95 = percentile(durations, 0.95);
  console.log(
    `${label}: p50 ${percentile(durations, 0.5).toFixed(3)} ms / p95 ${p95.toFixed(3)} ms / max ${durations.at(-1)!.toFixed(3)} ms`,
  );
  return p95;
};

describe("purchase returns and history benchmark", () => {
  let dir: string;
  let database: VendoraDatabase;
  let returns: ReturnType<typeof createPurchaseReturnsService>;
  let history: ReturnType<typeof createPurchaseHistoryService>;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-prn-bench-"));
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
          `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < @count - 1)
           INSERT INTO suppliers (id, store_id, name, created_at, updated_at)
           SELECT printf('00000000-0000-7000-b000-%012d', i), @storeId, 'Supplier ' || i, @base, @base
           FROM n`,
        )
        .run({ count: supplierCount, storeId, base });
      database.sqlite
        .prepare(
          `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < @count - 1)
           INSERT INTO goods_received_notes (id, store_id, terminal_id, grn_no, supplier_id, supplier_invoice_no, total_paisa, actor_user_id, created_at)
           SELECT printf('00000000-0000-7000-c000-%012d', i), @storeId, @terminalId,
                  printf('GRN-B-%06d', i), printf('00000000-0000-7000-b000-%012d', i % @suppliers),
                  'INV-' || i, 100000, @actorId, @base + i * 1000
           FROM n`,
        )
        .run({ count: noteCount, suppliers: supplierCount, storeId, terminalId, actorId, base });
      database.sqlite
        .prepare(
          `WITH RECURSIVE n(m) AS (SELECT 0 UNION ALL SELECT m + 1 FROM n WHERE m < @count - 1)
           INSERT INTO goods_received_lines (id, store_id, terminal_id, goods_received_note_id, position, product_id, name_en, unit, qty_milli, unit_cost_paisa, line_total_paisa, created_at)
           SELECT printf('00000000-0000-7000-d000-%012d', m), @storeId, @terminalId,
                  printf('00000000-0000-7000-c000-%012d', m / @perNote), m % @perNote,
                  printf('00000000-0000-7000-8000-%012d', (m * 7) % @products),
                  'Item', 'piece', 5000, 1000 + (m % 500), 5000 * (1000 + (m % 500)) / 1000,
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
      database.sqlite
        .prepare(
          `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < @count - 1)
           INSERT INTO purchase_returns (id, store_id, terminal_id, return_no, supplier_id, reason, total_paisa, actor_user_id, created_at)
           SELECT printf('00000000-0000-7000-e000-%012d', i), @storeId, @terminalId,
                  printf('PRN-B-%06d', i), printf('00000000-0000-7000-b000-%012d', i % @suppliers),
                  'damaged', 5000, @actorId, @base + i * 2500
           FROM n`,
        )
        .run({ count: returnCount, suppliers: supplierCount, storeId, terminalId, actorId, base });
      database.sqlite
        .prepare(
          `WITH RECURSIVE n(m) AS (SELECT 0 UNION ALL SELECT m + 1 FROM n WHERE m < @count - 1)
           INSERT INTO purchase_return_lines (id, store_id, terminal_id, purchase_return_id, position, product_id, name_en, unit, qty_milli, unit_cost_paisa, line_total_paisa, created_at)
           SELECT printf('00000000-0000-7000-f000-%012d', m), @storeId, @terminalId,
                  printf('00000000-0000-7000-e000-%012d', m / @perReturn), m % @perReturn,
                  printf('00000000-0000-7000-8000-%012d', (m * 13) % @products),
                  'Item', 'piece', 1000, 1000, 1000,
                  @base + (m / @perReturn) * 2500
           FROM n`,
        )
        .run({
          count: returnCount * linesPerReturn,
          perReturn: linesPerReturn,
          products: productCount,
          storeId,
          terminalId,
          base,
        });
    })();

    const sessions = createSessionStore();
    sessions.start({ userId: actorId, storeId, loggedInAt: new Date(0) });
    const audit = createAuditService(database);
    returns = createPurchaseReturnsService({
      database,
      audit,
      sessions,
      stock: createStockService({ database, audit }),
    });
    history = createPurchaseHistoryService({ database, sessions });
  }, 240_000);

  afterAll(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads what is left to return quickly", () => {
    const p95 = measure("returnable", 500, (n) => {
      returns.returnable({ supplierId: supplierId(n % supplierCount), productId: productId(n) });
    });
    expect(p95).toBeLessThan(10);
  });

  it("opens the first product history page quickly", () => {
    const p95 = measure("forProduct first page", 100, (n) => {
      const page = history.forProduct({
        productId: productId((n * 7919) % productCount),
        limit: 50,
        offset: 0,
      });
      expect(page.ok && page.items.length).toBe(50);
    });
    expect(p95).toBeLessThan(100);
  });

  it("opens the first supplier history page quickly", () => {
    const p95 = measure("forSupplier first page", 50, (n) => {
      const page = history.forSupplier({
        supplierId: supplierId(n % supplierCount),
        limit: 50,
        offset: 0,
      });
      expect(page.ok && page.items.length).toBe(50);
    });
    expect(p95).toBeLessThan(100);
  });

  it("posts a 50-line return quickly", () => {
    const picked = database.sqlite
      .prepare(
        `SELECT l.product_id AS id
         FROM goods_received_lines l JOIN goods_received_notes n ON n.id = l.goods_received_note_id
         WHERE n.supplier_id = ? GROUP BY l.product_id LIMIT 50`,
      )
      .all(supplierId(0)) as { id: string }[];
    expect(picked).toHaveLength(50);

    const start = performance.now();
    const result = returns.post(
      postPurchaseReturnInputSchema.parse({
        kind: "supplier",
        supplierId: supplierId(0),
        reason: "damaged",
        notes: null,
        lines: picked.map((row) => ({ productId: row.id, qtyMilli: 1000 })),
      }),
    );
    const elapsed = performance.now() - start;
    console.log(`post 50 lines: ${elapsed.toFixed(1)} ms`);

    expect(result.ok).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });
});
