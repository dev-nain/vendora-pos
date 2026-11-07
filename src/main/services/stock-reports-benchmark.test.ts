import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReportRange } from "../../shared/reports";
import {
  lowStockReportResultSchema,
  negativeStockReportResultSchema,
  postedStocktakesResultSchema,
  purchasesBySupplierResultSchema,
  stockMovementsColumns,
  stockMovementsReportResultSchema,
  stockOnHandColumns,
  stockOnHandResultSchema,
  stocktakeVarianceResultSchema,
} from "../../shared/stock-reports";
import { reportCsv } from "../reports/report-csv";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { createReportsService } from "./reports";

const productCount = 30_000;
const movementCount = 1_000_000;
const hotMovements = 10_000;
const supplierCount = 200;
const noteCount = 5_000;
const linesPerNote = 10;
const returnCount = 500;
const linesPerReturn = 4;
const stocktakeCount = 12;
const runs = 5;

const yearStart = Date.UTC(2025, 11, 31, 19, 0, 0);
const yearMs = 365 * 24 * 60 * 60 * 1000;
const fullYear: ReportRange = { from: "2026-01-01", to: "2026-12-31" };

const productId = (i: number) => `00000000-0000-7000-8000-${String(i).padStart(12, "0")}`;

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;

const measure = <T>(label: string, run: () => T): { result: T; p95: number } => {
  let result = run();
  const durations: number[] = [];
  for (let n = 0; n < runs; n++) {
    const start = performance.now();
    result = run();
    durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  const p95 = percentile(durations, 0.95);
  console.log(
    `${label}: p50 ${percentile(durations, 0.5).toFixed(1)} ms / p95 ${p95.toFixed(1)} ms / max ${durations.at(-1)!.toFixed(1)} ms`,
  );
  return { result, p95 };
};

describe("stock and purchasing reports benchmark", () => {
  let kit: CheckoutKit;
  let service: ReturnType<typeof createReportsService>;
  let firstStocktakeId = "";

  const scalar = (sql: string): number =>
    (kit.database.sqlite.prepare(sql).get() as { n: number }).n;

  beforeAll(() => {
    kit = createCheckoutKit();
    const actorId = kit.signIn("cashier").id;
    const args = {
      storeId: kit.storeId,
      terminalId: kit.terminalId,
      categoryId: kit.categoryId,
      taxCategoryId: kit.taxCategoryId("Standard"),
      actorId,
      yearStart,
      yearMs,
      products: productCount,
      movements: movementCount,
      hot: hotMovements,
      suppliers: supplierCount,
      notes: noteCount,
      perNote: linesPerNote,
      returns: returnCount,
      perReturn: linesPerReturn,
      stocktakes: stocktakeCount,
    };
    const { sqlite } = kit.database;
    sqlite.transaction(() => {
      sqlite
        .prepare(
          `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < @products - 1)
           INSERT INTO products (id, store_id, name_en, search_text, category_id, tax_category_id, unit, cost_paisa, sale_price_paisa, low_stock_threshold_milli, created_at, updated_at)
           SELECT printf('00000000-0000-7000-8000-%012d', i), @storeId, 'Item ' || i, 'item ' || i,
                  @categoryId, @taxCategoryId,
                  CASE i % 3 WHEN 0 THEN 'piece' WHEN 1 THEN 'kg' ELSE 'litre' END,
                  1000 + i % 500, 1500 + i % 500,
                  CASE WHEN i % 3 = 0 THEN 5000 ELSE NULL END, @yearStart, @yearStart
           FROM n`,
        )
        .run(args);
      sqlite
        .prepare(
          `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < @suppliers - 1)
           INSERT INTO suppliers (id, store_id, name, created_at, updated_at)
           SELECT printf('00000000-0000-7000-8000-e%011d', i), @storeId, 'Supplier ' || i, @yearStart, @yearStart
           FROM n`,
        )
        .run(args);
      sqlite
        .prepare(
          `WITH RECURSIVE n(j) AS (SELECT 0 UNION ALL SELECT j + 1 FROM n WHERE j < @notes - 1)
           INSERT INTO goods_received_notes (id, store_id, terminal_id, grn_no, supplier_id, supplier_invoice_no, total_paisa, actor_user_id, created_at)
           SELECT printf('00000000-0000-7000-8000-a%011d', j), @storeId, @terminalId, 'GRN-T1-' || printf('%06d', j),
                  printf('00000000-0000-7000-8000-e%011d', j % @suppliers), 'INV-' || j, 0, @actorId,
                  @yearStart + (j * (@yearMs / @notes))
           FROM n`,
        )
        .run(args);
      sqlite
        .prepare(
          `WITH RECURSIVE n(k) AS (SELECT 0 UNION ALL SELECT k + 1 FROM n WHERE k < @notes * @perNote - 1)
           INSERT INTO goods_received_lines (id, store_id, terminal_id, goods_received_note_id, position, product_id, name_en, unit, qty_milli, unit_cost_paisa, line_total_paisa, created_at)
           SELECT printf('00000000-0000-7000-8000-b%011d', k), @storeId, @terminalId,
                  printf('00000000-0000-7000-8000-a%011d', k / @perNote), k % @perNote,
                  printf('00000000-0000-7000-8000-%012d', (k * 7) % @products),
                  'Item', 'piece', 1000 + (k % 9) * 500, 1000 + k % 700,
                  (1000 + (k % 9) * 500) * (1000 + k % 700) / 1000,
                  @yearStart + ((k / @perNote) * (@yearMs / @notes))
           FROM n`,
        )
        .run(args);
      sqlite.exec(
        `UPDATE goods_received_notes SET total_paisa =
           (SELECT sum(line_total_paisa) FROM goods_received_lines WHERE goods_received_note_id = goods_received_notes.id)`,
      );
      sqlite
        .prepare(
          `WITH RECURSIVE n(j) AS (SELECT 0 UNION ALL SELECT j + 1 FROM n WHERE j < @returns - 1)
           INSERT INTO purchase_returns (id, store_id, terminal_id, return_no, supplier_id, reason, total_paisa, actor_user_id, created_at)
           SELECT printf('00000000-0000-7000-8000-c%011d', j), @storeId, @terminalId, 'PRN-T1-' || printf('%06d', j),
                  printf('00000000-0000-7000-8000-e%011d', (j * 3) % @suppliers), 'damaged', 0, @actorId,
                  @yearStart + (j * (@yearMs / @returns))
           FROM n`,
        )
        .run(args);
      sqlite
        .prepare(
          `WITH RECURSIVE n(k) AS (SELECT 0 UNION ALL SELECT k + 1 FROM n WHERE k < @returns * @perReturn - 1)
           INSERT INTO purchase_return_lines (id, store_id, terminal_id, purchase_return_id, position, product_id, name_en, unit, qty_milli, unit_cost_paisa, line_total_paisa, created_at)
           SELECT printf('00000000-0000-7000-8000-d%011d', k), @storeId, @terminalId,
                  printf('00000000-0000-7000-8000-c%011d', k / @perReturn), k % @perReturn,
                  printf('00000000-0000-7000-8000-%012d', (k * 11) % @products),
                  'Item', 'piece', 1000 + (k % 4) * 500, 1000 + k % 300,
                  (1000 + (k % 4) * 500) * (1000 + k % 300) / 1000,
                  @yearStart + ((k / @perReturn) * (@yearMs / @returns))
           FROM n`,
        )
        .run(args);
      sqlite.exec(
        `UPDATE purchase_returns SET total_paisa =
           (SELECT sum(line_total_paisa) FROM purchase_return_lines WHERE purchase_return_id = purchase_returns.id)`,
      );
      sqlite
        .prepare(
          `WITH RECURSIVE n(m) AS (SELECT 0 UNION ALL SELECT m + 1 FROM n WHERE m < @movements - 1)
           INSERT INTO stock_movements (id, store_id, terminal_id, product_id, type, qty_milli, unit_cost_paisa, source_type, source_id, actor_user_id, created_at)
           SELECT printf('00000000-0000-7000-9000-%012d', m), @storeId, @terminalId,
                  printf('00000000-0000-7000-8000-%012d', CASE WHEN m < @hot THEN 0 ELSE (m - @hot) % @products END),
                  CASE WHEN m % 3 != 0 THEN 'receipt' ELSE 'sale' END,
                  (CASE WHEN m % 3 != 0 THEN 1 ELSE -1 END) * (1000 + (m % 7) * 250),
                  1000 + (m % 500),
                  CASE WHEN m < @hot AND m % 3 != 0 THEN 'goods_received_line' END,
                  CASE WHEN m < @hot AND m % 3 != 0 THEN printf('00000000-0000-7000-8000-b%011d', m % (@notes * @perNote)) END,
                  @actorId, @yearStart + (m * (@yearMs / @movements))
           FROM n`,
        )
        .run(args);
      sqlite
        .prepare(
          `WITH RECURSIVE s(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM s WHERE i < @stocktakes - 1)
           INSERT INTO stocktakes (id, store_id, terminal_id, scope, status, started_by, posted_at, posted_by, created_at, updated_at)
           SELECT printf('00000000-0000-7000-8000-f%011d', i), @storeId, @terminalId, 'full', 'posted', @actorId,
                  @yearStart + (i * 30 + 14) * 86400000, @actorId, @yearStart + (i * 30 + 14) * 86400000 - 3600000, @yearStart
           FROM s`,
        )
        .run(args);
      sqlite
        .prepare(
          `WITH RECURSIVE n(k) AS (SELECT 0 UNION ALL SELECT k + 1 FROM n WHERE k < @stocktakes * @products - 1)
           INSERT INTO stocktake_lines (id, store_id, terminal_id, stocktake_id, product_id, expected_qty_milli, counted_qty_milli, counted_at, unit_cost_paisa, created_at, updated_at)
           SELECT printf('00000000-0000-7000-8000-9%011d', k), @storeId, @terminalId,
                  printf('00000000-0000-7000-8000-f%011d', k / @products),
                  printf('00000000-0000-7000-8000-%012d', k % @products),
                  10000 + (k % 100) * 10,
                  10000 + (k % 100) * 10 + CASE WHEN k % 20 = 0 THEN (CASE WHEN k % 40 = 0 THEN -1000 ELSE 1000 END) ELSE 0 END,
                  @yearStart + ((k / @products) * 30 + 14) * 86400000,
                  1000 + k % 500, @yearStart, @yearStart
           FROM n`,
        )
        .run(args);
    })();
    firstStocktakeId = "00000000-0000-7000-8000-f00000000000";
    service = createReportsService({
      database: kit.database,
      sessions: kit.sessions,
      renderer: { toPdf: async () => Buffer.alloc(0), print: async () => "printed" },
      chooseSavePath: async () => null,
      now: () => new Date("2026-12-31T12:00:00.000Z"),
    });
  }, 900_000);

  afterAll(() => kit.close());

  it("seeds a year of stock and purchasing data", () => {
    expect(scalar("SELECT count(*) AS n FROM stock_movements")).toBe(movementCount);
    expect(scalar("SELECT count(*) AS n FROM goods_received_notes")).toBe(noteCount);
    expect(scalar("SELECT count(*) AS n FROM stocktake_lines")).toBe(stocktakeCount * productCount);
  });

  it("renders stock on hand in under 3 seconds and matches the ledger", () => {
    const { result, p95 } = measure("stock on hand", () =>
      stockOnHandResultSchema.parse(service.stockOnHand()),
    );
    expect(result.rows).toHaveLength(productCount);
    const direct = scalar("SELECT sum(qty_milli) AS n FROM stock_movements");
    expect(result.rows.reduce((sum, row) => sum + row.onHandMilli, 0)).toBe(direct);
    expect(p95).toBeLessThan(3000);

    const csv = measure("stock on hand, csv build", () =>
      reportCsv({
        columns: stockOnHandColumns,
        rows: result.rows,
        totals: result.totals,
        totalsLabel: "Total",
      }),
    );
    expect(csv.result.length).toBeGreaterThan(productCount);
  }, 120_000);

  it("renders low stock in under 3 seconds", () => {
    const { result, p95 } = measure("low stock", () =>
      lowStockReportResultSchema.parse(service.lowStock()),
    );
    const direct = scalar(
      `SELECT count(*) AS n FROM (SELECT p.id FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
         WHERE p.low_stock_threshold_milli IS NOT NULL GROUP BY p.id
         HAVING coalesce(sum(m.qty_milli), 0) <= p.low_stock_threshold_milli)`,
    );
    expect(result.rows).toHaveLength(direct);
    expect(p95).toBeLessThan(3000);
  }, 120_000);

  it("renders negative stock in under 3 seconds", () => {
    const { result, p95 } = measure("negative stock", () =>
      negativeStockReportResultSchema.parse(service.negativeStock()),
    );
    const direct = scalar(
      `SELECT count(*) AS n FROM (SELECT product_id FROM stock_movements GROUP BY product_id HAVING sum(qty_milli) < 0)`,
    );
    expect(result.rows).toHaveLength(direct);
    expect(p95).toBeLessThan(3000);
  }, 120_000);

  it("renders the hot product's movements over the full year in under 3 seconds", () => {
    const { result, p95 } = measure("stock movements, hot product, full year", () =>
      stockMovementsReportResultSchema.parse(
        service.stockMovements({ productId: productId(0), range: fullYear }),
      ),
    );
    expect(result.rows).toHaveLength(
      scalar(`SELECT count(*) AS n FROM stock_movements WHERE product_id = '${productId(0)}'`),
    );
    expect(result.closingMilli).toBe(
      scalar(
        `SELECT sum(qty_milli) AS n FROM stock_movements WHERE product_id = '${productId(0)}'`,
      ),
    );
    expect(result.rows.some((row) => row.reference.startsWith("GRN "))).toBe(true);
    expect(p95).toBeLessThan(3000);

    const csv = measure("stock movements, csv build", () =>
      reportCsv({
        columns: stockMovementsColumns,
        rows: result.rows,
        totals: result.totals,
        totalsLabel: "Total",
      }),
    );
    expect(csv.result.length).toBeGreaterThan(hotMovements);
  }, 120_000);

  it("renders purchases by supplier over the full year in under 3 seconds", () => {
    const { result, p95 } = measure("purchases by supplier, full year", () =>
      purchasesBySupplierResultSchema.parse(service.purchasesBySupplier(fullYear)),
    );
    expect(result.rows).toHaveLength(supplierCount);
    expect(result.totals.receivedPaisa).toBe(
      scalar("SELECT sum(total_paisa) AS n FROM goods_received_notes"),
    );
    expect(result.totals.returnedPaisa).toBe(
      scalar("SELECT sum(total_paisa) AS n FROM purchase_returns"),
    );
    expect(result.totals.netPaisa).toBe(result.totals.receivedPaisa - result.totals.returnedPaisa);
    expect(p95).toBeLessThan(3000);
  }, 120_000);

  it("renders stocktake variance for all counts and for one count in under 3 seconds", () => {
    const everything = measure("stocktake variance, all counts", () =>
      stocktakeVarianceResultSchema.parse(
        service.stocktakeVariance({ range: fullYear, stocktakeId: null }),
      ),
    );
    const one = measure("stocktake variance, one count", () =>
      stocktakeVarianceResultSchema.parse(
        service.stocktakeVariance({ range: fullYear, stocktakeId: firstStocktakeId }),
      ),
    );
    const listed = measure("posted stocktakes", () =>
      postedStocktakesResultSchema.parse(service.postedStocktakes(fullYear)),
    );
    const varianceLines = scalar(
      "SELECT count(*) AS n FROM stocktake_lines WHERE counted_qty_milli <> expected_qty_milli",
    );
    expect(everything.result.rows).toHaveLength(varianceLines);
    expect(everything.result.countCount).toBe(stocktakeCount);
    expect(one.result.rows).toHaveLength(varianceLines / stocktakeCount);
    expect(listed.result.items).toHaveLength(stocktakeCount);
    expect(everything.p95).toBeLessThan(3000);
    expect(one.p95).toBeLessThan(3000);
    expect(listed.p95).toBeLessThan(3000);
  }, 120_000);
});
