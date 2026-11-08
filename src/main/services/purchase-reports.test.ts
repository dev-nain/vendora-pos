import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentModel } from "../../shared/document";
import { postGoodsReceivedInputSchema } from "../../shared/goods-received";
import { postPurchaseReturnInputSchema } from "../../shared/purchase-returns";
import type { ReportExportFormat } from "../../shared/reports";
import { UnauthenticatedError } from "../auth/errors";
import {
  categories,
  goodsReceivedLines,
  goodsReceivedNotes,
  products,
  stockMovements,
  stores,
  suppliers,
} from "../db/schema";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { createGoodsReceivedService } from "./goods-received";
import { createPurchaseReturnsService } from "./purchase-returns";
import { createReportsService } from "./reports";
import { createStockService } from "./stock";
import { createStocktakeService } from "./stocktake";

const range = (from: string, to = from) => ({ from, to });

const paisa = (value: number) =>
  `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, "0")}`;

describe("purchases by supplier report", () => {
  let kit: CheckoutKit;
  let clock: Date;
  let service: ReturnType<typeof createReportsService>;
  let goodsReceived: ReturnType<typeof createGoodsReceivedService>;
  let purchaseReturns: ReturnType<typeof createPurchaseReturnsService>;
  let toPdf: ReturnType<typeof vi.fn<(model: DocumentModel) => Promise<Buffer>>>;
  let chooseSavePath: ReturnType<
    typeof vi.fn<(name: string, format: ReportExportFormat) => Promise<string | null>>
  >;
  let alNoor: string;
  let rehman: string;
  let tea: string;

  const at = (iso: string) => {
    clock = new Date(iso);
  };

  beforeEach(() => {
    kit = createCheckoutKit();
    kit.signIn("cashier");
    clock = new Date("2026-11-01T06:00:00.000Z");
    const now = () => clock;
    const stock = createStockService({ database: kit.database, audit: kit.audit, now });
    goodsReceived = createGoodsReceivedService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      stock,
      now,
    });
    purchaseReturns = createPurchaseReturnsService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      stock,
      now,
    });
    toPdf = vi.fn(async () => Buffer.from("%PDF-1.4 fake"));
    chooseSavePath = vi.fn(async (name: string) => join(kit.dir, name));
    service = createReportsService({
      database: kit.database,
      sessions: kit.sessions,
      renderer: { toPdf, print: vi.fn(async () => "printed" as const) },
      chooseSavePath,
      now,
    });
    const supplier = (name: string) =>
      kit.database.db.insert(suppliers).values({ storeId: kit.storeId, name }).returning().get().id;
    alNoor = supplier("Al-Noor");
    rehman = supplier("rehman Traders");
    tea = kit.addProduct({ nameEn: "Tea", searchText: "tea", costPaisa: 100_000 }).id;
  });

  afterEach(() => kit.close());

  const receive = (supplierId: string, qtyMilli: number, unitCostPaisa: number) => {
    const result = goodsReceived.post(
      postGoodsReceivedInputSchema.parse({
        kind: "direct",
        supplierId,
        supplierInvoiceNo: "INV-1",
        lines: [{ productId: tea, qtyMilli, unitCostPaisa }],
      }),
    );
    if (!result.ok) throw new Error(`receive failed: ${result.reason}`);
    return result.note;
  };

  const giveBack = (supplierId: string, qtyMilli: number) => {
    const result = purchaseReturns.post(
      postPurchaseReturnInputSchema.parse({
        kind: "supplier",
        supplierId,
        reason: "damaged",
        notes: null,
        lines: [{ productId: tea, qtyMilli }],
      }),
    );
    if (!result.ok) throw new Error(`return failed: ${result.reason}`);
    return result.purchaseReturn;
  };

  it("nets purchases of returns", () => {
    at("2026-11-02T06:00:00.000Z");
    receive(alNoor, 10_000, 100_000);
    receive(alNoor, 5_000, 50_000);
    at("2026-11-03T06:00:00.000Z");
    const given = giveBack(alNoor, 1_000);

    const report = service.purchasesBySupplier(range("2026-11-01", "2026-11-07"));

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      supplier: "Al-Noor",
      receiptCount: 2,
      receivedPaisa: 1_000_000 + 250_000,
      returnCount: 1,
      returnedPaisa: given.totalPaisa,
      netPaisa: 1_250_000 - given.totalPaisa,
    });
    expect(report.totals).toEqual({
      receiptCount: 2,
      receivedPaisa: 1_250_000,
      returnCount: 1,
      returnedPaisa: given.totalPaisa,
      netPaisa: 1_250_000 - given.totalPaisa,
    });
  });

  it("gives a supplier with only a return in range a negative net", () => {
    at("2026-10-20T06:00:00.000Z");
    receive(rehman, 10_000, 100_000);
    at("2026-11-03T06:00:00.000Z");
    const given = giveBack(rehman, 2_000);

    const report = service.purchasesBySupplier(range("2026-11-01", "2026-11-07"));

    expect(report.rows).toMatchObject([
      { supplier: "rehman Traders", receiptCount: 0, returnCount: 1, receivedPaisa: 0 },
    ]);
    expect(report.rows[0]?.netPaisa).toBe(-given.totalPaisa);
    expect(report.totals.netPaisa).toBe(-given.totalPaisa);
  });

  it("leaves out a return after the range even when its note is inside it", () => {
    at("2026-11-02T06:00:00.000Z");
    receive(alNoor, 10_000, 100_000);
    at("2026-11-09T06:00:00.000Z");
    giveBack(alNoor, 1_000);

    const report = service.purchasesBySupplier(range("2026-11-01", "2026-11-07"));

    expect(report.rows[0]).toMatchObject({ receiptCount: 1, returnCount: 0, returnedPaisa: 0 });
  });

  it("lists archived suppliers, ordered by name without regard to case", () => {
    at("2026-11-02T06:00:00.000Z");
    receive(rehman, 1_000, 100_000);
    receive(alNoor, 1_000, 100_000);
    kit.database.db
      .update(suppliers)
      .set({ deletedAt: new Date() })
      .where(eq(suppliers.id, alNoor))
      .run();

    const report = service.purchasesBySupplier(range("2026-11-01", "2026-11-07"));

    expect(report.rows.map((row) => row.supplier)).toEqual(["Al-Noor", "rehman Traders"]);
  });

  it("totals the rows and the notes' headers equal their lines", () => {
    at("2026-11-02T06:00:00.000Z");
    receive(alNoor, 3_000, 33_333);
    receive(rehman, 7_000, 12_345);

    const report = service.purchasesBySupplier(range("2026-11-01", "2026-11-07"));
    const lineTotal = kit.database.db
      .select()
      .from(goodsReceivedLines)
      .all()
      .reduce((sum, line) => sum + line.lineTotalPaisa, 0);
    const headerTotal = kit.database.db
      .select()
      .from(goodsReceivedNotes)
      .all()
      .reduce((sum, note) => sum + note.totalPaisa, 0);

    expect(report.totals.receivedPaisa).toBe(report.rows.reduce((s, r) => s + r.receivedPaisa, 0));
    expect(report.totals.receivedPaisa).toBe(headerTotal);
    expect(headerTotal).toBe(lineTotal);
    expect(Object.values(report.totals).every(Number.isInteger)).toBe(true);
  });

  it("counts a note on its own Karachi store day", () => {
    at("2026-11-02T18:59:59.000Z");
    receive(alNoor, 1_000, 100_000);
    at("2026-11-02T19:00:00.000Z");
    receive(alNoor, 1_000, 100_000);

    expect(service.purchasesBySupplier(range("2026-11-02")).rows[0]?.receiptCount).toBe(1);
    expect(service.purchasesBySupplier(range("2026-11-03")).rows[0]?.receiptCount).toBe(1);
    expect(service.purchasesBySupplier(range("2026-11-04")).rows).toEqual([]);
  });

  it("leaves out another store's notes", () => {
    at("2026-11-02T06:00:00.000Z");
    receive(alNoor, 1_000, 100_000);
    const other = kit.database.db.insert(stores).values({ name: "Other" }).returning().get();
    kit.database.db.update(goodsReceivedNotes).set({ storeId: other.id }).run();

    expect(service.purchasesBySupplier(range("2026-11-01", "2026-11-07")).rows).toEqual([]);
  });

  it("refuses when signed out", async () => {
    kit.sessions.end();

    expect(() => service.purchasesBySupplier(range("2026-11-01"))).toThrow(UnauthenticatedError);
    await expect(
      service.exportPurchasesBySupplier({ range: range("2026-11-01"), format: "csv" }),
    ).rejects.toThrow(UnauthenticatedError);
  });

  it("exports the CSV and the PDF", async () => {
    at("2026-11-02T06:00:00.000Z");
    receive(alNoor, 10_000, 105_050);
    const given = giveBack(alNoor, 2_000);

    await service.exportPurchasesBySupplier({
      range: range("2026-11-01", "2026-11-07"),
      format: "csv",
    });
    await service.exportPurchasesBySupplier({
      range: range("2026-11-01", "2026-11-07"),
      format: "pdf",
    });

    const lines = readFileSync(
      join(kit.dir, "purchases-by-supplier-2026-11-01-to-2026-11-07.csv"),
      "utf8",
    )
      .slice(1)
      .split("\r\n");
    expect(lines[0]).toBe("Supplier,Receipts,Received,Returns,Returned,Net purchases");
    expect(lines[1]).toBe(
      `Al-Noor,1,${paisa(1_050_500)},1,${paisa(given.totalPaisa)},${paisa(1_050_500 - given.totalPaisa)}`,
    );
    expect(toPdf.mock.calls[0]?.[0].reference).toBe("1 Nov 2026 – 7 Nov 2026");
    expect(toPdf.mock.calls[0]?.[0].title).toBe("Purchases by supplier");
  });
});

describe("stocktake variance report", () => {
  let kit: CheckoutKit;
  let clock: Date;
  let service: ReturnType<typeof createReportsService>;
  let stocktake: ReturnType<typeof createStocktakeService>;
  let toPdf: ReturnType<typeof vi.fn<(model: DocumentModel) => Promise<Buffer>>>;
  let userId: string;
  let snacksId: string;

  const at = (iso: string) => {
    clock = new Date(iso);
  };

  beforeEach(() => {
    kit = createCheckoutKit();
    userId = kit.signIn("cashier").id;
    clock = new Date("2026-11-01T06:00:00.000Z");
    const now = () => clock;
    stocktake = createStocktakeService({
      database: kit.database,
      sessions: kit.sessions,
      stock: createStockService({ database: kit.database, audit: kit.audit, now }),
      audit: kit.audit,
      now,
    });
    toPdf = vi.fn(async () => Buffer.from("%PDF-1.4 fake"));
    service = createReportsService({
      database: kit.database,
      sessions: kit.sessions,
      renderer: { toPdf, print: vi.fn(async () => "printed" as const) },
      chooseSavePath: async (name: string) => join(kit.dir, name),
      now,
    });
    snacksId = kit.database.db
      .insert(categories)
      .values({ storeId: kit.storeId, name: "Snacks" })
      .returning()
      .get().id;
  });

  afterEach(() => kit.close());

  const stocked = (
    nameEn: string,
    onHandMilli: number,
    overrides: Partial<typeof products.$inferInsert> = {},
  ) => {
    const product = kit.addProduct({ nameEn, searchText: nameEn.toLowerCase(), ...overrides });
    kit.database.db
      .insert(stockMovements)
      .values({
        storeId: kit.storeId,
        terminalId: kit.terminalId,
        productId: product.id,
        type: "opening",
        qtyMilli: onHandMilli,
        unitCostPaisa: 0,
        actorUserId: userId,
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
      })
      .run();
    return product;
  };

  const countAndPost = (
    scope: { scope: "full" } | { scope: "category"; categoryId: string },
    counted: Record<string, number>,
  ) => {
    const started = stocktake.start(scope);
    if (!started.ok) throw new Error(`start refused: ${started.reason}`);
    const id = started.stocktake.id;
    const lines = stocktake.lines({ stocktakeId: id, query: "", limit: 100, offset: 0 });
    if (!lines.ok) throw new Error("lines refused");
    for (const line of lines.items) {
      const countedMilli = counted[line.nameEn];
      if (countedMilli === undefined) continue;
      const recorded = stocktake.record({ stocktakeId: id, lineId: line.id, countedMilli });
      if (!recorded.ok) throw new Error(`record refused: ${recorded.reason}`);
    }
    const result = stocktake.post({ stocktakeId: id });
    if (!result.ok) throw new Error(`post refused: ${result.reason}`);
    return id;
  };

  const reviewOf = (stocktakeId: string) => {
    const result = stocktake.review({ stocktakeId });
    if (!result.ok) throw new Error("review refused");
    return result.review;
  };

  const all = range("2026-11-01", "2026-11-07");

  function seedTwoCounts() {
    const sugar = stocked("Loose sugar", 25_000, { unit: "kg", costPaisa: 14_333 });
    const tea = stocked("Tea", 12_000, { costPaisa: 105_050 });
    const chips = stocked("Chips", 40_000, { costPaisa: 2_500, categoryId: snacksId });
    at("2026-11-03T10:05:00.000Z");
    const full = countAndPost(
      { scope: "full" },
      { "Loose sugar": 24_250, Tea: 12_000, Chips: 40_000 },
    );
    at("2026-11-04T10:05:00.000Z");
    const category = countAndPost({ scope: "category", categoryId: snacksId }, { Chips: 41_000 });
    return { sugar, tea, chips, full, category };
  }

  it("matches each posted count's review", () => {
    const { full, category } = seedTwoCounts();

    const report = service.stocktakeVariance({ range: all, stocktakeId: null });

    for (const id of [full, category]) {
      const review = reviewOf(id);
      const rows = report.rows.filter(
        (row) =>
          row.postedAt === (id === full ? "2026-11-03T10:05:00.000Z" : "2026-11-04T10:05:00.000Z"),
      );
      expect(rows).toHaveLength(review.varianceLineCount);
      expect(rows.reduce((sum, row) => sum + row.valuePaisa, 0)).toBe(review.netValuePaisa);
    }
    expect(report.totals.valuePaisa).toBe(
      (reviewOf(full).netValuePaisa ?? 0) + (reviewOf(category).netValuePaisa ?? 0),
    );
    expect(report.shortValuePaisa).toBe(
      (reviewOf(full).shortValuePaisa ?? 0) + (reviewOf(category).shortValuePaisa ?? 0),
    );
    expect(report.surplusValuePaisa).toBe(
      (reviewOf(full).surplusValuePaisa ?? 0) + (reviewOf(category).surplusValuePaisa ?? 0),
    );
    expect(report.countCount).toBe(2);
  });

  it("lists only lines whose count differs, newest count first", () => {
    seedTwoCounts();

    const report = service.stocktakeVariance({ range: all, stocktakeId: null });

    expect(report.rows.map((row) => [row.count, row.product, row.varianceMilli])).toEqual([
      ["Category: Snacks", "Chips", 1_000],
      ["Full count", "Loose sugar", -750],
    ]);
    expect(report.rows[1]).toMatchObject({
      expectedMilli: 25_000,
      countedMilli: 24_250,
      valuePaisa: -10_750,
    });
  });

  it("values at the cost frozen when posted, not today's cost", () => {
    const { sugar } = seedTwoCounts();
    const before = service.stocktakeVariance({ range: all, stocktakeId: null });

    kit.database.db
      .update(products)
      .set({ costPaisa: 99_999 })
      .where(eq(products.id, sugar.id))
      .run();

    expect(service.stocktakeVariance({ range: all, stocktakeId: null })).toEqual(before);
  });

  it("filters to one count and leaves out counts outside the range", () => {
    const { full, category } = seedTwoCounts();

    expect(
      service.stocktakeVariance({ range: all, stocktakeId: full }).rows.map((row) => row.product),
    ).toEqual(["Loose sugar"]);
    expect(
      service.stocktakeVariance({ range: range("2026-11-04"), stocktakeId: null }).rows,
    ).toHaveLength(1);
    expect(
      service.stocktakeVariance({ range: range("2026-11-04"), stocktakeId: full }),
    ).toMatchObject({ countCount: 0, rows: [] });
    expect(
      service.stocktakeVariance({ range: range("2026-11-05", "2026-11-07"), stocktakeId: category })
        .rows,
    ).toEqual([]);
  });

  it("leaves out open and cancelled counts and zero-variance lines", () => {
    stocked("Tea", 12_000);
    at("2026-11-03T10:05:00.000Z");
    const open = stocktake.start({ scope: "full" });
    if (!open.ok) throw new Error("start refused");
    const lines = stocktake.lines({
      stocktakeId: open.stocktake.id,
      query: "",
      limit: 10,
      offset: 0,
    });
    if (!lines.ok) throw new Error("lines refused");
    stocktake.record({
      stocktakeId: open.stocktake.id,
      lineId: lines.items[0]?.id ?? "",
      countedMilli: 1_000,
    });

    expect(service.stocktakeVariance({ range: all, stocktakeId: null })).toMatchObject({
      countCount: 0,
      rows: [],
    });

    stocktake.cancel({ stocktakeId: open.stocktake.id });
    expect(service.stocktakeVariance({ range: all, stocktakeId: null }).rows).toEqual([]);

    countAndPost({ scope: "full" }, { Tea: 12_000 });
    expect(service.stocktakeVariance({ range: all, stocktakeId: null })).toMatchObject({
      countCount: 1,
      rows: [],
      totals: { valuePaisa: 0 },
    });
  });

  it("lists only posted counts in range, newest first, with their labels", () => {
    const { full, category } = seedTwoCounts();
    stocktake.start({ scope: "full" });

    expect(service.postedStocktakes(all)).toEqual({
      items: [
        { id: category, postedAt: "2026-11-04T10:05:00.000Z", label: "Category: Snacks" },
        { id: full, postedAt: "2026-11-03T10:05:00.000Z", label: "Full count" },
      ],
    });
    expect(service.postedStocktakes(range("2026-11-05")).items).toEqual([]);
  });

  it("refuses when signed out", async () => {
    kit.sessions.end();

    expect(() => service.postedStocktakes(all)).toThrow(UnauthenticatedError);
    expect(() => service.stocktakeVariance({ range: all, stocktakeId: null })).toThrow(
      UnauthenticatedError,
    );
    await expect(
      service.exportStocktakeVariance({ range: all, stocktakeId: null, format: "csv" }),
    ).rejects.toThrow(UnauthenticatedError);
  });

  it("exports with the range, or the range and the count, as the PDF reference", async () => {
    const { full } = seedTwoCounts();

    await service.exportStocktakeVariance({ range: all, stocktakeId: null, format: "pdf" });
    await service.exportStocktakeVariance({ range: all, stocktakeId: full, format: "pdf" });
    await service.exportStocktakeVariance({ range: all, stocktakeId: full, format: "csv" });

    expect(toPdf.mock.calls.map((call) => call[0].reference)).toEqual([
      "1 Nov 2026 – 7 Nov 2026",
      "1 Nov 2026 – 7 Nov 2026 · 3 Nov 2026, 3:05 pm · Full count",
    ]);
    const lines = readFileSync(
      join(kit.dir, "stocktake-variance-2026-11-01-to-2026-11-07.csv"),
      "utf8",
    )
      .slice(1)
      .split("\r\n");
    expect(lines[0]).toBe("Posted,Count,Product,Unit,Expected,Counted,Variance,Value");
    expect(lines[1]).toBe("2026-11-03 15:05,Full count,Loose sugar,kg,25,24.25,-0.75,-107.50");
    expect(lines[2]).toBe("Total,,,,,,,-107.50");
  });
});
