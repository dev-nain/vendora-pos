import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { salesByDayResultSchema, type ReportRange } from "../../shared/reports";
import { fixtureCounts, seedReportFixture } from "./report-benchmark-fixture";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { createReportsService } from "./reports";

const runs = 5;

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;

const rowCount = (kit: CheckoutKit, table: string) =>
  (kit.database.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

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

  it("renders sales by day for a full year in under 3 seconds", () => {
    const service = createReportsService({
      database: kit.database,
      sessions: kit.sessions,
      renderer: { toPdf: async () => Buffer.alloc(0), print: async () => "printed" },
      chooseSavePath: async () => null,
    });
    const durations: number[] = [];
    let last = salesByDayResultSchema.parse(service.salesByDay(range));
    for (let run = 0; run < runs; run++) {
      const start = performance.now();
      last = salesByDayResultSchema.parse(service.salesByDay(range));
      durations.push(performance.now() - start);
    }
    const sorted = durations.toSorted((a, b) => a - b);
    const p95 = percentile(sorted, 0.95);
    console.log(
      `sales by day, full year: p50 ${percentile(sorted, 0.5).toFixed(1)} ms / p95 ${p95.toFixed(1)} ms / max ${sorted.at(-1)!.toFixed(1)} ms`,
    );

    const direct = kit.database.sqlite
      .prepare("SELECT count(*) AS bills, sum(total_paisa) AS total FROM sales")
      .get() as { bills: number; total: number };
    expect(last.rows).toHaveLength(365);
    expect(last.totals.totalPaisa).toBe(direct.total);
    expect(last.totals.billCount).toBe(direct.bills);
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
  });
});
