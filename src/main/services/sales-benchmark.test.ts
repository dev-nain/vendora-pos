import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "../db/id";
import { productBarcodes, saleLines } from "../db/schema";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { createSalesService } from "./sales";
import { createStockService } from "./stock";

const productCount = 30_000;
const billLines = 50;
const completeRuns = 30;
const scanRuns = 200;
const barcodedProducts = billLines + scanRuns;

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;

const report = (label: string, durations: number[]) => {
  const sorted = durations.toSorted((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  console.log(
    `${label}: p50 ${p50.toFixed(3)} ms / p95 ${p95.toFixed(3)} ms / max ${sorted.at(-1)!.toFixed(3)} ms`,
  );
  return p95;
};

describe("checkout benchmark", () => {
  let kit: CheckoutKit;
  let sales: ReturnType<typeof createSalesService>;
  const productIds: string[] = [];

  beforeAll(() => {
    kit = createCheckoutKit();
    const user = kit.signIn("cashier");
    kit.openShift();
    const taxCategoryId = kit.taxCategoryId("Standard");

    const insertProduct = kit.database.sqlite.prepare(
      `INSERT INTO products (id, store_id, name_en, search_text, category_id, tax_category_id, unit, cost_paisa, sale_price_paisa, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'piece', ?, ?, ?, ?)`,
    );
    const insertMovement = kit.database.sqlite.prepare(
      `INSERT INTO stock_movements (id, store_id, terminal_id, product_id, type, qty_milli, unit_cost_paisa, actor_user_id, created_at)
       VALUES (?, ?, ?, ?, 'receipt', ?, ?, ?, ?)`,
    );
    const base = Date.now();
    kit.database.sqlite.transaction(() => {
      for (let i = 0; i < productCount; i++) {
        const id = uuidv7();
        productIds.push(id);
        insertProduct.run(
          id,
          kit.storeId,
          `Item ${i}`,
          `item ${i}`,
          kit.categoryId,
          taxCategoryId,
          1000 + i,
          1500 + i,
          base,
          base,
        );
        insertMovement.run(
          uuidv7(),
          kit.storeId,
          kit.terminalId,
          id,
          100_000,
          1000 + i,
          user.id,
          base,
        );
      }
    })();
    kit.database.db
      .insert(productBarcodes)
      .values(
        productIds.slice(0, barcodedProducts).map((productId, i) => ({
          storeId: kit.storeId,
          productId,
          barcode: `890${String(i).padStart(9, "0")}`,
        })),
      )
      .run();

    sales = createSalesService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      stock: createStockService({ database: kit.database, audit: kit.audit }),
    });
  }, 180_000);

  afterAll(() => kit.close());

  it("completes a 50-line sale inside the payment-to-print target", () => {
    const draftIds: string[] = [];
    for (let run = 0; run < completeRuns; run++) {
      for (let line = 0; line < billLines; line++) {
        const result = kit.billDrafts.addProduct({
          productId: productIds[(run * billLines + line) % productCount]!,
          qtyMilli: 2000,
        });
        if (!result.ok) throw new Error("add failed");
        if (line === billLines - 1) {
          draftIds.push(result.bill.id);
          kit.billDrafts.hold({ draftId: result.bill.id });
        }
      }
    }

    const durations: number[] = [];
    for (const draftId of draftIds) {
      const start = performance.now();
      const result = sales.complete({
        draftId,
        payments: [{ method: "cash", amountPaisa: 100_000_000 }],
      });
      durations.push(performance.now() - start);
      expect(result.ok).toBe(true);
    }

    expect(report("complete 50 lines", durations)).toBeLessThan(1500);
  }, 120_000);

  it("scans into a 49-line bill quickly", () => {
    for (let line = 0; line < billLines - 1; line++) {
      const result = kit.billDrafts.scan({ barcode: `890${String(line).padStart(9, "0")}` });
      if (!result.ok) throw new Error("scan failed");
    }

    const durations: number[] = [];
    for (let run = 0; run < scanRuns; run++) {
      const barcode = `890${String(billLines + run).padStart(9, "0")}`;
      const start = performance.now();
      const result = kit.billDrafts.scan({ barcode });
      durations.push(performance.now() - start);
      if (!result.ok) throw new Error("scan failed");
      kit.billDrafts.deleteLine({ lineId: result.bill.lines.at(-1)!.id });
    }

    expect(report("scan into 49-line bill", durations)).toBeLessThan(100);
  }, 120_000);

  it("scans into a bill with 20 linked return lines quickly", () => {
    const current = kit.billDrafts.current().bill;
    if (current) kit.billDrafts.hold({ draftId: current.id });

    let draftId = "";
    for (let line = 0; line < 20; line++) {
      const result = kit.billDrafts.addProduct({ productId: productIds[line]!, qtyMilli: 3000 });
      if (!result.ok) throw new Error("add failed");
      draftId = result.bill.id;
    }
    const sold = sales.complete({
      draftId,
      payments: [{ method: "cash", amountPaisa: 100_000_000 }],
    });
    if (!sold.ok) throw new Error("sale failed");
    const original = kit.database.db
      .select({ id: saleLines.id })
      .from(saleLines)
      .where(eq(saleLines.saleId, sold.sale.id))
      .all();
    const added = kit.returns.addFromSale({
      saleId: sold.sale.id,
      lines: original.map((row) => ({ saleLineId: row.id, qtyMilli: 1000 })),
    });
    if (!added.ok) throw new Error("return failed");
    expect(added.bill.lines).toHaveLength(20);

    const durations: number[] = [];
    for (let run = 0; run < 100; run++) {
      const barcode = `890${String(billLines + run).padStart(9, "0")}`;
      const start = performance.now();
      const result = kit.billDrafts.scan({ barcode });
      durations.push(performance.now() - start);
      if (!result.ok) throw new Error("scan failed");
      kit.billDrafts.deleteLine({ lineId: result.bill.lines.at(-1)!.id });
    }

    expect(report("scan into 20 linked return lines", durations)).toBeLessThan(100);
  }, 120_000);
});
