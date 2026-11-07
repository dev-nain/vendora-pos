import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { paymentMethods } from "../../shared/checkout";
import {
  paymentMethodsResultSchema,
  salesByCashierResultSchema,
  salesByCategoryResultSchema,
  salesByDayResultSchema,
  salesByHourResultSchema,
  salesByProductResultSchema,
  type ReportRange,
} from "../../shared/reports";
import { fixtureCounts, seedReportFixture } from "./report-benchmark-fixture";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { createReportsService, type ReportsService } from "./reports";
import { shiftSalesSummary } from "./shift-sales";

const runs = 5;

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;

const rowCount = (kit: CheckoutKit, table: string) =>
  (kit.database.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

function timed<T>(label: string, run: () => T): { last: T; p95: number } {
  let last = run();
  const durations: number[] = [];
  for (let index = 0; index < runs; index++) {
    const start = performance.now();
    last = run();
    durations.push(performance.now() - start);
  }
  const sorted = durations.toSorted((a, b) => a - b);
  const p95 = percentile(sorted, 0.95);
  console.log(
    `${label}: p50 ${percentile(sorted, 0.5).toFixed(1)} ms / p95 ${p95.toFixed(1)} ms / max ${sorted.at(-1)!.toFixed(1)} ms`,
  );
  return { last, p95 };
}

describe("reports benchmark", () => {
  let kit: CheckoutKit;
  let range: ReportRange;
  let service: ReportsService;
  let shiftId: string;

  const lineNet = () =>
    (
      kit.database.sqlite
        .prepare("SELECT sum(total_paisa - tax_paisa) AS net FROM sale_lines")
        .get() as { net: number }
    ).net;

  beforeAll(() => {
    kit = createCheckoutKit();
    range = seedReportFixture(kit);
    shiftId = (kit.database.sqlite.prepare("SELECT id FROM shifts").get() as { id: string }).id;
    service = createReportsService({
      database: kit.database,
      sessions: kit.sessions,
      renderer: { toPdf: async () => Buffer.alloc(0), print: async () => "printed" },
      chooseSavePath: async () => null,
    });
  }, 600_000);

  afterAll(() => kit.close());

  it("seeds a year of sales and lines", () => {
    expect(rowCount(kit, "sales")).toBe(fixtureCounts.sales);
    expect(rowCount(kit, "sale_lines")).toBe(fixtureCounts.sales * fixtureCounts.linesPerSale);
    expect(rowCount(kit, "sale_payments")).toBe(fixtureCounts.sales);
  });

  it("renders sales by day for a full year in under 3 seconds", () => {
    const { last, p95 } = timed("sales by day, full year", () =>
      salesByDayResultSchema.parse(service.salesByDay(range)),
    );
    const direct = kit.database.sqlite
      .prepare("SELECT count(*) AS bills, sum(total_paisa) AS total FROM sales")
      .get() as { bills: number; total: number };
    expect(last.rows).toHaveLength(365);
    expect(last.totals.totalPaisa).toBe(direct.total);
    expect(last.totals.billCount).toBe(direct.bills);
    expect(last.totals.grossPaisa - last.totals.returnsPaisa).toBe(last.totals.netPaisa);
    expect(p95).toBeLessThan(3000);
  }, 120_000);

  it("renders sales by hour for a full year in under 3 seconds", () => {
    const { last, p95 } = timed("sales by hour, full year", () =>
      salesByHourResultSchema.parse(service.salesByHour(range)),
    );
    expect(last.rows).toHaveLength(24);
    expect(last.totals).toEqual(service.salesByDay(range).totals);
    expect(p95).toBeLessThan(3000);
  }, 120_000);

  it("renders sales by product for a full year in under 3 seconds", () => {
    const { last, p95 } = timed("sales by product, full year", () =>
      salesByProductResultSchema.parse(service.salesByProduct(range)),
    );
    expect(last.rows).toHaveLength(fixtureCounts.products);
    expect(last.totals.netPaisa).toBe(lineNet());
    expect(p95).toBeLessThan(3000);
  }, 120_000);

  it("renders sales by category for a full year in under 3 seconds", () => {
    const { last, p95 } = timed("sales by category, full year", () =>
      salesByCategoryResultSchema.parse(service.salesByCategory(range)),
    );
    expect(last.rows).toHaveLength(fixtureCounts.categories);
    expect(last.totals.netPaisa).toBe(lineNet());
    expect(p95).toBeLessThan(3000);
  }, 120_000);

  it("renders sales by cashier for a full year in under 3 seconds", () => {
    const { last, p95 } = timed("sales by cashier, full year", () =>
      salesByCashierResultSchema.parse(service.salesByCashier(range)),
    );
    expect(last.rows).toHaveLength(1);
    expect(last.totals.netPaisa).toBe(lineNet());
    expect(p95).toBeLessThan(3000);
  }, 120_000);

  it("renders sales by payment method for a full year in under 3 seconds", () => {
    const { last, p95 } = timed("payment method, full year by range", () =>
      paymentMethodsResultSchema.parse(service.paymentMethods({ range })),
    );
    const direct = kit.database.sqlite
      .prepare("SELECT sum(amount_paisa) AS net FROM sale_payments")
      .get() as { net: number };
    expect(last.rows).toHaveLength(paymentMethods.length);
    expect(last.totals.netPaisa).toBe(direct.net);
    expect(p95).toBeLessThan(3000);
  }, 120_000);

  it("renders sales by payment method for the fixture's shift in under 3 seconds", () => {
    const { last, p95 } = timed("payment method, full year by shift", () =>
      paymentMethodsResultSchema.parse(service.paymentMethods({ shiftId })),
    );
    const summary = shiftSalesSummary(kit.database.db, shiftId);
    expect(last.totals.netPaisa).toBe(summary.sales.totalPaisa);
    for (const entry of summary.sales.byMethod) {
      expect(last.rows.find((row) => row.method === entry.label)?.netPaisa).toBe(entry.amountPaisa);
    }
    expect(p95).toBeLessThan(3000);
  }, 120_000);

  it("logs the query plans", () => {
    const where = "sales.store_id = ? AND sales.created_at >= ? AND sales.created_at < ?";
    const args = [kit.storeId, 0, Date.now() * 2];
    const planOf = (query: string, params: (string | number)[] = args) =>
      (
        kit.database.sqlite.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...params) as {
          detail: string;
        }[]
      )
        .map((row) => row.detail)
        .join(" | ");
    const day = "(sales.created_at + 18000000) / 86400000";
    const hour = "((sales.created_at + 18000000) / 3600000) % 24";
    console.log(
      `plan, sales aggregate: ${planOf(`SELECT ${day}, count(*), sum(total_paisa) FROM sales WHERE ${where} GROUP BY ${day}`)}`,
    );
    console.log(
      `plan, line aggregate by day: ${planOf(`SELECT ${day}, sum(sale_lines.total_paisa) FROM sale_lines INNER JOIN sales ON sales.id = sale_lines.sale_id WHERE ${where} GROUP BY ${day}`)}`,
    );
    console.log(
      `plan, line aggregate by hour: ${planOf(`SELECT ${hour}, sum(sale_lines.total_paisa) FROM sale_lines INNER JOIN sales ON sales.id = sale_lines.sale_id WHERE ${where} GROUP BY ${hour}`)}`,
    );
    console.log(
      `plan, line aggregate by product: ${planOf(`SELECT sale_lines.product_id, max(sale_lines.created_at), sum(sale_lines.total_paisa) FROM sale_lines INNER JOIN sales ON sales.id = sale_lines.sale_id WHERE ${where} GROUP BY sale_lines.product_id`)}`,
    );
    console.log(
      `plan, payments by range: ${planOf(`SELECT sale_payments.method, sum(sale_payments.amount_paisa) FROM sale_payments INNER JOIN sales ON sales.id = sale_payments.sale_id WHERE ${where} GROUP BY sale_payments.method`)}`,
    );
    console.log(
      `plan, payments by shift: ${planOf(`SELECT sale_payments.method, sum(sale_payments.amount_paisa) FROM sale_payments INNER JOIN sales ON sales.id = sale_payments.sale_id WHERE sales.store_id = ? AND sales.shift_id = '${shiftId}' GROUP BY sale_payments.method`, [kit.storeId])}`,
    );
  });
});
