import type { ReportRange } from "../../shared/reports";
import type { CheckoutKit } from "./checkout-test-kit";

export const fixtureCounts = {
  products: 30_000,
  categories: 20,
  sales: 100_000,
  linesPerSale: 5,
  refundEvery: 50,
} as const;

export const fixtureRange: ReportRange = { from: "2026-01-01", to: "2026-12-31" };

const yearStartUtcMs = Date.UTC(2025, 11, 31, 19);
const yearMs = 365 * 24 * 60 * 60 * 1000;

const integerParams =
  /@(categoryCount|productCount|saleCount|lineCount|linesPerSale|refundEvery|start|step)\b/g;

// better-sqlite3 binds JS numbers as REAL, which would turn the integer arithmetic below into float arithmetic.
const integers = (text: string) => text.replaceAll(integerParams, "CAST(@$1 AS INTEGER)");

export function seedReportFixture(kit: CheckoutKit): ReportRange {
  const user = kit.signIn("cashier");
  const shiftId = kit.openShift();
  const { sqlite } = kit.database;

  const params = {
    storeId: kit.storeId,
    terminalId: kit.terminalId,
    shiftId,
    userId: user.id,
    taxCategoryId: kit.taxCategoryId("Standard"),
    categoryCount: fixtureCounts.categories,
    productCount: fixtureCounts.products,
    saleCount: fixtureCounts.sales,
    lineCount: fixtureCounts.sales * fixtureCounts.linesPerSale,
    linesPerSale: fixtureCounts.linesPerSale,
    refundEvery: fixtureCounts.refundEvery,
    start: yearStartUtcMs,
    step: Math.floor(yearMs / fixtureCounts.sales),
  };

  sqlite.transaction(() => {
    sqlite.pragma("defer_foreign_keys = ON");

    sqlite
      .prepare(
        integers(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < @categoryCount - 1)
         INSERT INTO categories (id, store_id, name, created_at, updated_at)
         SELECT printf('00000000-0000-7000-a000-%012d', i), @storeId, 'Category ' || i, @start, @start
         FROM n`),
      )
      .run(params);

    sqlite
      .prepare(
        integers(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < @productCount - 1)
         INSERT INTO products (id, store_id, name_en, search_text, category_id, tax_category_id, unit, cost_paisa, sale_price_paisa, created_at, updated_at)
         SELECT printf('00000000-0000-7000-8000-%012d', i), @storeId, 'Item ' || i, 'item ' || i,
                printf('00000000-0000-7000-a000-%012d', i % @categoryCount), @taxCategoryId,
                CASE i % 10 WHEN 0 THEN 'kg' WHEN 1 THEN 'litre' ELSE 'piece' END,
                1000 + i % 500, 1500 + i % 500, @start, @start
         FROM n`),
      )
      .run(params);

    sqlite
      .prepare(
        integers(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < @saleCount - 1)
         INSERT INTO bill_drafts (id, store_id, terminal_id, shift_id, state, created_by, created_at, updated_at)
         SELECT printf('00000000-0000-7000-8003-%012d', i), @storeId, @terminalId, @shiftId, 'paid', @userId,
                @start + i * @step, @start + i * @step
         FROM n`),
      )
      .run(params);

    sqlite
      .prepare(
        integers(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < @lineCount - 1),
         a AS (
           SELECT i, i / @linesPerSale AS s, i % @linesPerSale AS k, i % @productCount AS p,
                  CASE WHEN (i / @linesPerSale + 1) % @refundEvery = 0 THEN -1 ELSE 1 END AS sign
           FROM n
         ),
         b AS (
           SELECT *,
                  CASE WHEN p % 10 < 2 THEN 500 * (1 + k % 4) ELSE 1000 * (1 + k % 3) END AS qty,
                  1500 + p % 500 AS price,
                  CASE p % 10 WHEN 0 THEN 'kg' WHEN 1 THEN 'litre' ELSE 'piece' END AS unit,
                  CASE p % 10 WHEN 3 THEN 0 WHEN 4 THEN 500 ELSE 1800 END AS rate,
                  p % 10 = 5 AS third
           FROM a
         ),
         c AS (SELECT *, qty * price / 1000 AS gross FROM b),
         d AS (SELECT *, CASE WHEN k = 2 THEN gross / 20 ELSE 0 END AS disc FROM c),
         e AS (SELECT *, gross - disc AS total FROM d)
         INSERT INTO sale_lines (id, store_id, terminal_id, sale_id, position, product_id, name_en, unit, qty_milli, is_return,
                                 unit_price_paisa, cost_paisa, tax_rate_bps, is_third_schedule, gross_paisa, line_discount_paisa,
                                 bill_discount_paisa, discount_paisa, tax_paisa, total_paisa, category_id, category_name, created_at)
         SELECT printf('00000000-0000-7000-8002-%012d', i), @storeId, @terminalId,
                printf('00000000-0000-7000-8001-%012d', s), k,
                printf('00000000-0000-7000-8000-%012d', p), 'Item ' || p, unit, sign * qty, sign < 0,
                price, 1000 + p % 500, rate, third, sign * gross, sign * disc, 0, sign * disc,
                sign * (total * rate / (10000 + rate)), sign * total,
                printf('00000000-0000-7000-a000-%012d', p % @categoryCount), 'Category ' || (p % @categoryCount),
                @start + s * @step
         FROM e`),
      )
      .run(params);

    sqlite
      .prepare(
        integers(`INSERT INTO sales (id, store_id, terminal_id, shift_id, draft_id, invoice_no, type, cashier_user_id, prices_include_tax,
                            subtotal_paisa, discount_paisa, tax_paisa, rounding_paisa, total_paisa, created_at)
         SELECT sale_id, @storeId, @terminalId, @shiftId, replace(sale_id, '-8001-', '-8003-'),
                'T1-' || substr(sale_id, -12), CASE WHEN total < 0 THEN 'refund' ELSE 'sale' END, @userId, 1,
                gross, disc, tax, abs(total) % 5 - 2, total + abs(total) % 5 - 2, created
         FROM (
           SELECT sale_id, sum(gross_paisa) AS gross, sum(discount_paisa) AS disc, sum(tax_paisa) AS tax,
                  sum(total_paisa) AS total, min(created_at) AS created
           FROM sale_lines GROUP BY sale_id
         )`),
      )
      .run(params);

    sqlite
      .prepare(
        integers(`INSERT INTO sale_payments (id, store_id, terminal_id, sale_id, position, method, amount_paisa, cashier_user_id, created_at)
         SELECT replace(id, '-8001-', '-8004-'), @storeId, @terminalId, id, 0,
                CASE WHEN abs(total_paisa) % 3 = 0 THEN 'card' ELSE 'cash' END, total_paisa, @userId, created_at
         FROM sales`),
      )
      .run(params);
  })();

  return fixtureRange;
}
