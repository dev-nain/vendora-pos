import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { backupRecords, saleLines } from "../db/schema";
import { createCheckoutKit, type CheckoutKit } from "../services/checkout-test-kit";
import { createBackupService } from "./backup-service";
import { createWorkerCopy } from "./worker-copy";

const saleLineCount = 500_000;
const productCount = 2_000;
const billLines = 10;
const tickMs = 5;
const idleTicks = 200;
const minBackupTicks = 5;

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;

const report = (label: string, durations: number[]) => {
  const sorted = durations.toSorted((a, b) => a - b);
  const p95 = percentile(sorted, 0.95);
  console.log(
    `${label}: p50 ${percentile(sorted, 0.5).toFixed(3)} ms / p95 ${p95.toFixed(3)} ms / max ${sorted.at(-1)!.toFixed(3)} ms (${sorted.length} samples)`,
  );
  return p95;
};

const productId = (i: number) => `00000000-0000-7000-8000-${String(i).padStart(12, "0")}`;

const lagOf = async (): Promise<number> => {
  const start = performance.now();
  await sleep(tickMs);
  return Math.max(0, performance.now() - start - tickMs);
};

describe("backup benchmark", () => {
  let kit: CheckoutKit;
  let productIds: string[];
  let nextProduct = 0;

  const seedProducts = (actorId: string) => {
    const params = {
      count: productCount,
      storeId: kit.storeId,
      terminalId: kit.terminalId,
      categoryId: kit.categoryId,
      taxCategoryId: kit.taxCategoryId("Standard"),
      actorId,
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
  };

  const cloneSaleLines = (extra: number) => {
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
      .run({ extra });
  };

  const heldBillOf = (lines: number): string => {
    let draftId = "";
    for (let line = 0; line < lines; line++) {
      const result = kit.billDrafts.addProduct({
        productId: productIds[nextProduct++ % productCount]!,
        qtyMilli: 2000,
      });
      if (!result.ok) throw new Error("add failed");
      draftId = result.bill.id;
    }
    kit.billDrafts.hold({ draftId });
    return draftId;
  };

  const addAndRemoveLine = (): number => {
    const start = performance.now();
    const result = kit.billDrafts.addProduct({
      productId: productIds[nextProduct++ % productCount]!,
      qtyMilli: 1000,
    });
    const elapsed = performance.now() - start;
    if (!result.ok) throw new Error("add failed");
    kit.billDrafts.deleteLine({ lineId: result.bill.lines.at(-1)!.id });
    return elapsed;
  };

  beforeAll(() => {
    kit = createCheckoutKit();
    const user = kit.signIn("cashier");
    kit.openShift();
    productIds = Array.from({ length: productCount }, (_, i) => productId(i));
    seedProducts(user.id);

    const draftId = heldBillOf(1);
    const sold = kit.sales.complete({
      draftId,
      payments: [{ method: "cash", amountPaisa: 100_000_000 }],
    });
    if (!sold.ok) throw new Error("sale failed");

    const existing = kit.database.db.select().from(saleLines).all().length;
    cloneSaleLines(saleLineCount - existing);
    kit.database.sqlite.pragma("wal_checkpoint(TRUNCATE)");
  }, 300_000);

  afterAll(() => kit.close());

  it("keeps billing fast while a backup of 500,000 sale lines runs", async () => {
    const count = kit.database.sqlite.prepare("SELECT count(*) AS n FROM sale_lines").get() as {
      n: number;
    };
    expect(count.n).toBe(saleLineCount);

    const idleAdd: number[] = [];
    const idleLag: number[] = [];
    for (let tick = 0; tick < idleTicks; tick++) {
      idleLag.push(await lagOf());
      idleAdd.push(addAndRemoveLine());
    }

    const completeDraftId = heldBillOf(billLines);
    const backupDir = join(kit.dir, "backups");
    const service = createBackupService({
      database: kit.database,
      audit: kit.audit,
      backupDir,
      copy: createWorkerCopy(resolve(process.cwd(), "src/main/backup/backup-worker.ts")),
    });

    const addDuring: number[] = [];
    const lagDuring: number[] = [];
    let completeMs = 0;
    const progress = { finished: false };
    const startedAt = performance.now();
    service.runDailyIfDue();
    const idle = service.whenIdle().then(() => {
      progress.finished = true;
    });
    while (!progress.finished) {
      lagDuring.push(await lagOf());
      addDuring.push(addAndRemoveLine());
      if (completeMs === 0 && addDuring.length >= 3) {
        const start = performance.now();
        const sold = kit.sales.complete({
          draftId: completeDraftId,
          payments: [{ method: "cash", amountPaisa: 100_000_000 }],
        });
        completeMs = performance.now() - start;
        expect(sold.ok).toBe(true);
      }
    }
    await idle;
    const backupMs = performance.now() - startedAt;

    const record = kit.database.db.select().from(backupRecords).get();
    expect(record).toMatchObject({ result: "ok" });
    console.log(
      `backup: ${(backupMs / 1000).toFixed(2)} s, ${((record?.sizeBytes ?? 0) / 1024 / 1024).toFixed(1)} MiB`,
    );
    report("event-loop lag, idle", idleLag);
    report("event-loop lag, during backup", lagDuring);
    report("add line, idle", idleAdd);
    const addP95 = report("add line, during backup", addDuring);
    console.log(`complete sale during backup: ${completeMs.toFixed(3)} ms`);
    expect(existsSync(join(backupDir, record!.fileName))).toBe(true);

    expect(addDuring.length).toBeGreaterThanOrEqual(minBackupTicks);
    expect(completeMs).toBeGreaterThan(0);
    expect(addP95).toBeLessThan(100);
    expect(completeMs).toBeLessThan(1500);
  }, 300_000);
});
