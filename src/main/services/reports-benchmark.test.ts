import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  discountsReturnsVoidsResultSchema,
  reportDetailLimit,
} from "../../shared/discounts-returns-voids";
import {
  grossProfitByCategoryResultSchema,
  grossProfitByProductResultSchema,
  salesByDayResultSchema,
  salesTaxSummaryResultSchema,
  type ReportRange,
} from "../../shared/reports";
import { divRoundHalfUp } from "../../shared/rounding";
import { fixtureCounts, seedReportFixture } from "./report-benchmark-fixture";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { createReportsService } from "./reports";

const runs = 5;

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;

const rowCount = (kit: CheckoutKit, table: string) =>
  (kit.database.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

function timed<T>(name: string, run: () => T): { last: T; p95: number } {
  let last = run();
  const durations: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    last = run();
    durations.push(performance.now() - start);
  }
  const sorted = durations.toSorted((a, b) => a - b);
  const p95 = percentile(sorted, 0.95);
  console.log(
    `${name}: p50 ${percentile(sorted, 0.5).toFixed(1)} ms / p95 ${p95.toFixed(1)} ms / max ${sorted.at(-1)!.toFixed(1)} ms`,
  );
  return { last, p95 };
}

describe("reports benchmark", () => {
  let kit: CheckoutKit;
  let range: ReportRange;

  beforeAll(() => {
    kit = createCheckoutKit();
    range = seedReportFixture(kit);
  }, 600_000);

  afterAll(() => kit.close());

  it("seeds a year of sales and lines", () => {
    expect(rowCount(kit, "sales")).toBe(fixtureCounts.sales);
    expect(rowCount(kit, "sale_lines")).toBe(fixtureCounts.sales * fixtureCounts.linesPerSale);
    expect(rowCount(kit, "sale_payments")).toBe(fixtureCounts.sales);
  });

  const count = (query: string) => (kit.database.sqlite.prepare(query).get() as { n: number }).n;

  const reports = () =>
    createReportsService({
      database: kit.database,
      sessions: kit.sessions,
      renderer: { toPdf: async () => Buffer.alloc(0), print: async () => "printed" },
      chooseSavePath: async () => null,
    });

  it("renders sales by day for a full year in under 3 seconds", () => {
    const service = reports();
    const { last, p95 } = timed("sales by day, full year", () =>
      salesByDayResultSchema.parse(service.salesByDay(range)),
    );

    const direct = kit.database.sqlite
      .prepare("SELECT count(*) AS bills, sum(total_paisa) AS total FROM sales")
      .get() as { bills: number; total: number };
    expect(last.rows).toHaveLength(365);
    expect(last.totals.totalPaisa).toBe(direct.total);
    expect(last.totals.billCount).toBe(direct.bills);
    expect(p95).toBeLessThan(3000);
  }, 120_000);

  function expectedGrossProfitTotals() {
    const net = kit.database.sqlite
      .prepare("SELECT sum(total_paisa - tax_paisa) AS net FROM sale_lines")
      .get() as { net: number };
    const lines = kit.database.sqlite
      .prepare("SELECT qty_milli, pack_qty_milli, cost_paisa FROM sale_lines")
      .all() as { qty_milli: number; pack_qty_milli: number; cost_paisa: number }[];
    let cost = 0;
    for (const line of lines) {
      const base = divRoundHalfUp(BigInt(line.qty_milli) * BigInt(line.pack_qty_milli), 1000n);
      cost += divRoundHalfUp(BigInt(base) * BigInt(line.cost_paisa), 1000n);
    }
    return { net: net.net, cost };
  }

  it("renders the sales tax summary for a full year in under 3 seconds", () => {
    const service = reports();
    const { last, p95 } = timed("sales tax summary, full year", () =>
      salesTaxSummaryResultSchema.parse(service.salesTaxSummary(range)),
    );

    const direct = kit.database.sqlite
      .prepare(
        "SELECT sum(total_paisa - tax_paisa) AS taxable, sum(tax_paisa) AS tax, sum(total_paisa) AS total FROM sale_lines",
      )
      .get() as { taxable: number; tax: number; total: number };
    expect(last.rows.map((row) => row.rate)).toEqual(["18%", "18% · Third Schedule", "5%", "0%"]);
    expect(last.totals).toEqual({
      taxablePaisa: direct.taxable,
      taxPaisa: direct.tax,
      totalPaisa: direct.total,
    });
    expect(p95).toBeLessThan(3000);
  }, 120_000);

  it("renders discounts, returns and voids for a full year in under 3 seconds", () => {
    const service = reports();
    const { last, p95 } = timed("discounts, returns and voids, full year", () =>
      discountsReturnsVoidsResultSchema.parse(service.discountsReturnsVoids(range)),
    );

    expect(last.discounts.billCount).toBe(
      count("SELECT count(*) AS n FROM sales WHERE discount_paisa <> 0"),
    );
    expect(last.discounts.bills).toHaveLength(reportDetailLimit);
    expect(last.returns.lineCount).toBe(
      count("SELECT count(*) AS n FROM sale_lines WHERE is_return = 1"),
    );
    expect(last.returns.summary.map((row) => row.lineCount)).toEqual([
      0,
      last.returns.lineCount,
      last.returns.summary[2]!.lineCount,
      count("SELECT count(*) AS n FROM stock_movements WHERE type = 'damage'"),
    ]);
    expect(last.returns.summary[2]!.lineCount + last.returns.summary[3]!.lineCount).toBe(
      last.returns.lineCount,
    );
    expect(last.voids.deletedLines.count).toBe(
      count("SELECT count(*) AS n FROM audit_log WHERE action = 'line_delete'"),
    );
    expect(last.voids.deletedLines.rows[0]!.billState).toBe("sold");
    expect(last.voids.discardedBills.count).toBe(fixtureCounts.discardedBills);
    expect(p95).toBeLessThan(3000);
  }, 120_000);

  it("renders gross profit by product for a full year in under 3 seconds", () => {
    const service = reports();
    const { last, p95 } = timed("gross profit by product, full year", () =>
      grossProfitByProductResultSchema.parse(service.grossProfitByProduct(range)),
    );

    const expected = expectedGrossProfitTotals();
    expect(last.rows).toHaveLength(fixtureCounts.products);
    expect(last.totals.netPaisa).toBe(expected.net);
    expect(last.totals.costPaisa).toBe(expected.cost);
    expect(p95).toBeLessThan(3000);
  }, 120_000);

  it("renders gross profit by category for a full year in under 3 seconds", () => {
    const service = reports();
    const { last, p95 } = timed("gross profit by category, full year", () =>
      grossProfitByCategoryResultSchema.parse(service.grossProfitByCategory(range)),
    );

    const expected = expectedGrossProfitTotals();
    expect(last.rows).toHaveLength(fixtureCounts.categories);
    expect(last.totals.netPaisa).toBe(expected.net);
    expect(last.totals.costPaisa).toBe(expected.cost);
    expect(p95).toBeLessThan(3000);
  }, 120_000);

  it("logs the query plans", () => {
    const bucket = "(sales.created_at + 18000000) / 86400000";
    const where = "sales.store_id = ? AND sales.created_at >= ? AND sales.created_at < ?";
    const args = [kit.storeId, 0, Date.now() * 2];
    const planOf = (query: string) =>
      (
        kit.database.sqlite.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...args) as {
          detail: string;
        }[]
      )
        .map((row) => row.detail)
        .join(" | ");
    console.log(
      `plan, sales aggregate: ${planOf(`SELECT ${bucket}, count(*), sum(total_paisa) FROM sales WHERE ${where} GROUP BY ${bucket}`)}`,
    );
    console.log(
      `plan, line aggregate: ${planOf(`SELECT ${bucket}, sum(sale_lines.qty_milli) FROM sale_lines INNER JOIN sales ON sales.id = sale_lines.sale_id WHERE ${where} GROUP BY ${bucket}`)}`,
    );
    console.log(
      `plan, tax summary aggregate: ${planOf(`SELECT sale_lines.tax_rate_bps, sale_lines.is_third_schedule, sum(sale_lines.total_paisa - sale_lines.tax_paisa), sum(sale_lines.tax_paisa), sum(sale_lines.total_paisa) FROM sale_lines INNER JOIN sales ON sales.id = sale_lines.sale_id WHERE ${where} GROUP BY sale_lines.tax_rate_bps, sale_lines.is_third_schedule`)}`,
    );
    console.log(
      `plan, returned lines: ${planOf(`WITH damaged AS (SELECT DISTINCT source_id FROM stock_movements WHERE type = 'damage' AND source_type = 'sale_line') SELECT count(*), sum(sale_lines.total_paisa) FROM sale_lines JOIN sales ON sales.id = sale_lines.sale_id JOIN products ON products.id = sale_lines.product_id LEFT JOIN damaged ON damaged.source_id = sale_lines.id WHERE ${where} AND sale_lines.is_return = 1`)}`,
    );
    console.log(
      `plan, audit entries: ${planOf(`SELECT count(*), sum(json_extract(audit_log.details, '$.grossPaisa')) FROM audit_log WHERE audit_log.store_id = ? AND audit_log.action = 'line_delete' AND audit_log.created_at >= ? AND audit_log.created_at < ?`)}`,
    );
  });

  it("logs the gross profit query plan", () => {
    const query = `SELECT sale_lines.product_id, max(sale_lines.created_at), sum(sale_lines.total_paisa - sale_lines.tax_paisa) FROM sale_lines INNER JOIN sales ON sales.id = sale_lines.sale_id WHERE sales.store_id = ? AND sales.created_at >= ? AND sales.created_at < ? GROUP BY sale_lines.product_id`;
    const plan = (
      kit.database.sqlite
        .prepare(`EXPLAIN QUERY PLAN ${query}`)
        .all(kit.storeId, 0, Date.now() * 2) as { detail: string }[]
    )
      .map((row) => row.detail)
      .join(" | ");
    console.log(`plan, gross profit line aggregate: ${plan}`);
  });
});
