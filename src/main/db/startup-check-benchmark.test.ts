import { statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCheckoutKit, type CheckoutKit } from "../services/checkout-test-kit";
import { checkDatabaseFile, STARTUP_CHECK } from "./startup-check";

const productCount = 30_000;
const saleLineCount = 500_000;
const runs = 3;
const budgetMs = 1_000;
const migrationsFolder = join(process.cwd(), "drizzle");

const median = (values: number[]) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]!;

describe("startup check benchmark", () => {
  let kit: CheckoutKit;
  let file: string;

  beforeAll(() => {
    kit = createCheckoutKit();
    const user = kit.signIn("cashier");
    kit.openShift();
    const params = {
      count: productCount,
      storeId: kit.storeId,
      terminalId: kit.terminalId,
      categoryId: kit.categoryId,
      taxCategoryId: kit.taxCategoryId("Standard"),
      actorId: user.id,
      base: Date.now(),
    };
    kit.database.sqlite.transaction(() => {
      kit.database.sqlite
        .prepare(
          `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < @count - 1)
           INSERT INTO products (id, store_id, name_en, search_text, category_id, tax_category_id, unit, cost_paisa, sale_price_paisa, created_at, updated_at)
           SELECT printf('00000000-0000-7000-8000-%012d', i), @storeId, 'Item ' || i, 'item ' || i,
                  @categoryId, @taxCategoryId, 'piece', 1000 + i, 1500 + i, @base, @base
           FROM n`,
        )
        .run(params);
      kit.database.sqlite
        .prepare(
          `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < @count - 1)
           INSERT INTO stock_movements (id, store_id, terminal_id, product_id, type, qty_milli, unit_cost_paisa, actor_user_id, created_at)
           SELECT printf('00000000-0000-7000-9000-%012d', i), @storeId, @terminalId,
                  printf('00000000-0000-7000-8000-%012d', i), 'receipt', 100000000, 1000 + i, @actorId, @base
           FROM n`,
        )
        .run(params);
    })();

    const draft = kit.billDrafts.addProduct({
      productId: "00000000-0000-7000-8000-000000000000",
      qtyMilli: 2000,
    });
    if (!draft.ok) throw new Error("add failed");
    const sold = kit.sales.complete({
      draftId: draft.bill.id,
      payments: [{ method: "cash", amountPaisa: 100_000_000 }],
    });
    if (!sold.ok) throw new Error("sale failed");

    kit.database.sqlite
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < @extra)
         INSERT INTO sale_lines (id, store_id, terminal_id, sale_id, position, product_id, name_en, name_ur, unit, qty_milli, is_return,
           unit_price_paisa, mrp_paisa, cost_paisa, tax_rate_bps, is_third_schedule, pct_code, gross_paisa, line_discount_paisa,
           bill_discount_paisa, discount_paisa, tax_paisa, total_paisa, refunded_sale_id, refunded_line_id, barcode, pack_qty_milli, created_at)
         SELECT printf('00000000-0000-7000-a000-%012d', n.i), l.store_id, l.terminal_id, l.sale_id, n.i, l.product_id, l.name_en, l.name_ur,
           l.unit, l.qty_milli, l.is_return, l.unit_price_paisa, l.mrp_paisa, l.cost_paisa, l.tax_rate_bps, l.is_third_schedule, l.pct_code,
           l.gross_paisa, l.line_discount_paisa, l.bill_discount_paisa, l.discount_paisa, l.tax_paisa, l.total_paisa, l.refunded_sale_id,
           l.refunded_line_id, l.barcode, l.pack_qty_milli, l.created_at
         FROM n, sale_lines l WHERE l.position = 0`,
      )
      .run({ extra: saleLineCount - 1 });
    kit.database.sqlite.pragma("wal_checkpoint(TRUNCATE)");
    kit.database.sqlite.close();
    file = join(kit.dir, "vendora.db");
  }, 300_000);

  afterAll(() => kit.close());

  it("finishes the chosen startup check within the budget on a year of data", () => {
    const timings = new Map<string, number[]>();
    for (const check of ["quick_check", "integrity_check"]) {
      const samples: number[] = [];
      for (let run = 0; run < runs; run++) {
        const start = performance.now();
        const result = checkDatabaseFile(file, migrationsFolder, check);
        samples.push(performance.now() - start);
        expect(result).toEqual({ status: "healthy" });
      }
      timings.set(check, samples);
      console.log(
        `${check}: p50 ${median(samples).toFixed(0)} ms / max ${Math.max(...samples).toFixed(0)} ms (${(statSync(file).size / 1_048_576).toFixed(0)} MiB, ${productCount} products, ${saleLineCount} sale lines)`,
      );
    }
    expect(median(timings.get(STARTUP_CHECK)!)).toBeLessThanOrEqual(budgetMs);
  }, 600_000);
});
