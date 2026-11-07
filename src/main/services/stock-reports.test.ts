import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentModel } from "../../shared/document";
import type { ReportExportFormat } from "../../shared/reports";
import { UnauthenticatedError } from "../auth/errors";
import { categories, products, stockMovements, stores, suppliers } from "../db/schema";
import type { DocumentRenderer } from "../documents/document-window";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { postGoodsReceivedInputSchema } from "../../shared/goods-received";
import { postPurchaseReturnInputSchema } from "../../shared/purchase-returns";
import { createGoodsReceivedService } from "./goods-received";
import { createInventoryService } from "./inventory";
import { createPurchaseReturnsService } from "./purchase-returns";
import { createSalesService } from "./sales";
import { createStockService } from "./stock";
import { createReportsService } from "./reports";

const NOW = new Date("2026-11-07T10:05:00.000Z");

const range = (from: string, to = from) => ({ from, to });

const everyPage = <T>(read: (offset: number) => { items: T[]; total: number }): T[] => {
  const all: T[] = [];
  for (let offset = 0; ; offset += 50) {
    const page = read(offset);
    all.push(...page.items);
    if (all.length >= page.total || page.items.length === 0) return all;
  }
};

describe("stock position reports", () => {
  let kit: CheckoutKit;
  let userId: string;
  let tick: number;
  let service: ReturnType<typeof createReportsService>;
  let inventory: ReturnType<typeof createInventoryService>;
  let toPdf: ReturnType<typeof vi.fn<(model: DocumentModel) => Promise<Buffer>>>;
  let chooseSavePath: ReturnType<
    typeof vi.fn<(name: string, format: ReportExportFormat) => Promise<string | null>>
  >;

  beforeEach(() => {
    kit = createCheckoutKit();
    userId = kit.signIn("cashier").id;
    tick = 0;
    toPdf = vi.fn(async () => Buffer.from("%PDF-1.4 fake"));
    chooseSavePath = vi.fn(async (name: string) => join(kit.dir, name));
    const renderer: DocumentRenderer = { toPdf, print: vi.fn(async () => "printed" as const) };
    service = createReportsService({
      database: kit.database,
      sessions: kit.sessions,
      renderer,
      chooseSavePath,
      now: () => NOW,
    });
    inventory = createInventoryService({
      database: kit.database,
      sessions: kit.sessions,
      stock: kit.stock,
    });
  });

  afterEach(() => kit.close());

  const product = (nameEn: string, overrides: Partial<typeof products.$inferInsert> = {}) =>
    kit.addProduct({ nameEn, searchText: nameEn.toLowerCase(), ...overrides });

  const move = (productId: string, qtyMilli: number, createdAt = new Date(NOW.getTime() - 1000)) =>
    kit.database.db
      .insert(stockMovements)
      .values({
        storeId: kit.storeId,
        terminalId: kit.terminalId,
        productId,
        type: "receipt",
        qtyMilli,
        unitCostPaisa: 0,
        actorUserId: userId,
        createdAt: new Date(createdAt.getTime() + tick++),
      })
      .returning()
      .get();

  describe("stock on hand", () => {
    it("values on hand at the current cost in integer paisa", () => {
      const sugar = product("Loose sugar", { unit: "kg", costPaisa: 14333 });
      move(sugar.id, 1333);

      const { rows, totals } = service.stockOnHand();

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        onHandMilli: 1333,
        costPaisa: 14333,
        stockValuePaisa: 19106,
      });
      expect(totals.stockValuePaisa).toBe(19106);
    });

    it("values negative stock negatively, never as -0, and totals the rounded rows", () => {
      const soap = product("Lux soap", { costPaisa: 8500 });
      const nothing = product("Nothing", { costPaisa: 100 });
      const tea = product("Tea", { costPaisa: 33 });
      move(soap.id, -2000);
      move(nothing.id, 1);
      move(nothing.id, -1);
      move(tea.id, 1);

      const { rows, totals } = service.stockOnHand();
      const byName = Object.fromEntries(rows.map((row) => [row.product, row]));

      expect(byName["Lux soap"]?.stockValuePaisa).toBe(-17000);
      expect(Object.is(byName["Nothing"]?.stockValuePaisa, -0)).toBe(false);
      expect(byName["Nothing"]?.stockValuePaisa).toBe(0);
      expect(byName["Tea"]?.stockValuePaisa).toBe(0);
      expect(totals.stockValuePaisa).toBe(rows.reduce((sum, row) => sum + row.stockValuePaisa, 0));
      expect(rows.every((row) => Number.isInteger(row.stockValuePaisa))).toBe(true);
    });

    it("lists the Stock screen's rows: every active product, zero included", () => {
      const weighed = product("Loose sugar", { unit: "kg", costPaisa: 14333 });
      const counted = product("Tea", { costPaisa: 1050 });
      product("No movements", { costPaisa: 500 });
      product("Archived", { isActive: false });
      move(weighed.id, 24250);
      move(counted.id, 12000);

      const screen = everyPage((offset) => inventory.list({ query: "", limit: 50, offset }));
      const report = service.stockOnHand().rows;

      expect(report.map((row) => row.productId)).toEqual(screen.map((item) => item.id));
      expect(report.map((row) => row.onHandMilli)).toEqual(screen.map((item) => item.onHandMilli));
      expect(report.map((row) => row.costPaisa)).toEqual(screen.map((item) => item.costPaisa));
      expect(report.map((row) => row.stockValuePaisa)).toEqual(
        screen.map((item) => item.stockValuePaisa),
      );
      expect(report.map((row) => row.product)).not.toContain("Archived");
      expect(report.find((row) => row.product === "No movements")?.onHandMilli).toBe(0);
    });

    it("names each product's category", () => {
      const snacks = kit.database.db
        .insert(categories)
        .values({ storeId: kit.storeId, name: "Snacks" })
        .returning()
        .get();
      product("Chips", { categoryId: snacks.id });

      expect(service.stockOnHand().rows[0]?.category).toBe("Snacks");
    });

    it("revalues straight away when the cost changes", () => {
      const tea = product("Tea", { costPaisa: 1000 });
      move(tea.id, 2000);
      expect(service.stockOnHand().totals.stockValuePaisa).toBe(2000);

      kit.database.db
        .update(products)
        .set({ costPaisa: 1500 })
        .where(eq(products.id, tea.id))
        .run();

      expect(service.stockOnHand().totals.stockValuePaisa).toBe(3000);
    });

    it("carries the time it was read", () => {
      expect(service.stockOnHand().asOf).toBe(NOW.toISOString());
    });
  });

  describe("low stock", () => {
    it("lists exactly what the Low stock screen lists", () => {
      const tea = product("Tea", { lowStockThresholdMilli: 10000 });
      const sugar = product("Sugar", { unit: "kg", lowStockThresholdMilli: 5000 });
      const fine = product("Fine", { lowStockThresholdMilli: 1000 });
      product("Archived", { lowStockThresholdMilli: 1000, isActive: false });
      product("No threshold");
      move(tea.id, 10000);
      move(sugar.id, 1500);
      move(fine.id, 5000);

      const screen = everyPage((offset) => inventory.lowStock({ limit: 50, offset }));
      const report = service.lowStock();

      expect(report.rows.map((row) => row.productId)).toEqual(screen.map((item) => item.id));
      expect(report.rows.map((row) => row.onHandMilli)).toEqual(
        screen.map((item) => item.onHandMilli),
      );
      expect(report.rows.map((row) => row.shortfallMilli)).toEqual(
        screen.map((item) => item.shortfallMilli),
      );
      expect(report.rows.map((row) => row.product)).toEqual(["Sugar", "Tea"]);
      expect(report.totals).toEqual({});
    });
  });

  describe("negative stock", () => {
    it("lists exactly what the negative-stock list lists", () => {
      const soap = product("Lux soap", { costPaisa: 8500 });
      const sugar = product("Sugar", { unit: "kg", costPaisa: 14333 });
      const fine = product("Fine");
      product("Archived", { isActive: false });
      move(soap.id, -2000);
      move(sugar.id, -750);
      move(fine.id, 3000);

      const screen = everyPage((offset) => inventory.negativeStock({ limit: 50, offset }));
      const report = service.negativeStock();

      expect(report.rows.map((row) => row.productId)).toEqual(screen.map((item) => item.id));
      expect(report.rows.map((row) => row.onHandMilli)).toEqual([-2000, -750]);
      expect(report.rows.map((row) => row.stockValuePaisa)).toEqual(
        screen.map((item) => item.stockValuePaisa),
      );
      expect(report.rows.map((row) => row.lastMovementAt)).toEqual(
        screen.map((item) => item.lastMovementAt),
      );
      expect(report.totals.stockValuePaisa).toBe(-17000 - 10750);
    });
  });

  describe("signed out", () => {
    it("refuses every read and export", async () => {
      kit.sessions.end();

      expect(() => service.stockOnHand()).toThrow(UnauthenticatedError);
      expect(() => service.lowStock()).toThrow(UnauthenticatedError);
      expect(() => service.negativeStock()).toThrow(UnauthenticatedError);
      await expect(service.exportStockOnHand({ format: "csv" })).rejects.toThrow(
        UnauthenticatedError,
      );
      await expect(service.exportLowStock({ format: "pdf" })).rejects.toThrow(UnauthenticatedError);
      await expect(service.exportNegativeStock({ format: "csv" })).rejects.toThrow(
        UnauthenticatedError,
      );
      expect(chooseSavePath).not.toHaveBeenCalled();
    });
  });

  describe("export", () => {
    it("writes a CSV with the unit column and bare numbers", async () => {
      const sugar = product("Loose sugar", { unit: "kg", costPaisa: 14333 });
      const tea = product("Tea", { costPaisa: 105050 });
      move(sugar.id, 24250);
      move(tea.id, 10000);

      const result = await service.exportStockOnHand({ format: "csv" });

      expect(chooseSavePath).toHaveBeenCalledWith("stock-on-hand-2026-11-07.csv", "csv");
      expect(result).toEqual({
        ok: true,
        status: "saved",
        path: join(kit.dir, "stock-on-hand-2026-11-07.csv"),
      });
      const lines = readFileSync(join(kit.dir, "stock-on-hand-2026-11-07.csv"), "utf8")
        .slice(1)
        .split("\r\n");
      expect(lines[0]).toBe("Product,Category,Unit,On hand,Average cost,Value");
      expect(lines[1]).toMatch(/^Loose sugar,.+,kg,24\.25,143\.33,3475\.\d\d$/);
      expect(lines[2]).toMatch(/^Tea,.+,pcs,10,1050\.50,10505\.00$/);
      expect(lines[3]).toMatch(/^Total,,,,,\d+\.\d\d$/);
    });

    it("leaves the Total line out of the low stock CSV", async () => {
      const tea = product("Tea", { lowStockThresholdMilli: 10000 });
      move(tea.id, 4000);

      await service.exportLowStock({ format: "csv" });

      const lines = readFileSync(join(kit.dir, "low-stock-2026-11-07.csv"), "utf8")
        .slice(1)
        .split("\r\n");
      expect(lines).toEqual([
        "Product,Category,Unit,On hand,Low-stock level,Shortfall",
        expect.stringMatching(/^Tea,.+,pcs,4,10,6$/),
        "",
      ]);
    });

    it("builds the PDF with an as-of reference and the valuation basis", async () => {
      await service.exportStockOnHand({ format: "pdf" });

      expect(chooseSavePath).toHaveBeenCalledWith("stock-on-hand-2026-11-07.pdf", "pdf");
      const model = toPdf.mock.calls[0]?.[0];
      expect(model?.title).toBe("Stock on hand and valuation");
      expect(model?.reference).toBe("As of 7 Nov 2026, 3:05 pm");
      expect(model?.facts).toEqual([
        { label: "Times", value: "Asia/Karachi" },
        { label: "Valued at", value: "Current average cost" },
      ]);
    });

    it("names the negative stock file by the store day", async () => {
      await service.exportNegativeStock({ format: "csv" });
      expect(chooseSavePath).toHaveBeenCalledWith("negative-stock-2026-11-07.csv", "csv");
    });

    it("reports a cancelled save without writing", async () => {
      chooseSavePath.mockResolvedValueOnce(null);
      expect(await service.exportLowStock({ format: "csv" })).toEqual({
        ok: true,
        status: "cancelled",
      });
    });
  });
});

describe("stock movements report", () => {
  let kit: CheckoutKit;
  let clock: Date;
  let service: ReturnType<typeof createReportsService>;
  let inventory: ReturnType<typeof createInventoryService>;
  let goodsReceived: ReturnType<typeof createGoodsReceivedService>;
  let purchaseReturns: ReturnType<typeof createPurchaseReturnsService>;
  let selling: ReturnType<typeof createSalesService>;
  let toPdf: ReturnType<typeof vi.fn<(model: DocumentModel) => Promise<Buffer>>>;
  let chooseSavePath: ReturnType<
    typeof vi.fn<(name: string, format: ReportExportFormat) => Promise<string | null>>
  >;
  let supplierId: string;

  const at = (iso: string) => {
    clock = new Date(iso);
  };

  beforeEach(() => {
    kit = createCheckoutKit();
    kit.signIn("cashier");
    kit.openShift();
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
    selling = createSalesService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      stock,
      now,
    });
    inventory = createInventoryService({
      database: kit.database,
      sessions: kit.sessions,
      stock,
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
    supplierId = kit.database.db
      .insert(suppliers)
      .values({ storeId: kit.storeId, name: "Al-Noor" })
      .returning()
      .get().id;
  });

  afterEach(() => kit.close());

  const tea = (overrides: Partial<typeof products.$inferInsert> = {}) =>
    kit.addProduct({
      nameEn: "Tea",
      searchText: "tea",
      costPaisa: 1000,
      taxCategoryId: kit.taxCategoryId("Exempt"),
      ...overrides,
    });

  const receive = (productId: string, qtyMilli: number, unitCostPaisa: number) => {
    const result = goodsReceived.post(
      postGoodsReceivedInputSchema.parse({
        kind: "direct",
        supplierId,
        supplierInvoiceNo: "INV-1",
        lines: [{ productId, qtyMilli, unitCostPaisa }],
      }),
    );
    if (!result.ok) throw new Error(`receive failed: ${result.reason}`);
    return result.note;
  };

  const sell = (productId: string, qtyMilli: number) => {
    const bill = kit.billDrafts.addProduct({ productId, qtyMilli });
    if (!bill.ok) throw new Error("add failed");
    const result = selling.complete({
      draftId: bill.bill.id,
      payments: [{ method: "cash", amountPaisa: 1_000_000 }],
    });
    if (!result.ok) throw new Error("sale failed");
    return result.sale;
  };

  const read = (productId: string, from: string, to?: string) =>
    service.stockMovements({ productId, range: range(from, to) });

  it("lists only the range's movements, oldest first, with opening and running balance", () => {
    const product = tea();
    at("2026-10-30T06:00:00.000Z");
    receive(product.id, 5000, 1000);
    at("2026-11-02T06:00:00.000Z");
    receive(product.id, 10000, 1000);
    at("2026-11-03T06:00:00.000Z");
    sell(product.id, 3000);
    at("2026-11-09T06:00:00.000Z");
    receive(product.id, 7000, 1000);

    const report = read(product.id, "2026-11-01", "2026-11-07");

    expect(report.openingMilli).toBe(5000);
    expect(report.rows.map((row) => [row.type, row.qtyMilli, row.balanceMilli])).toEqual([
      ["Receipt", 10000, 15000],
      ["Sale", -3000, 12000],
    ]);
    expect(report.closingMilli).toBe(12000);
  });

  it("ends at the product's on hand when the range ends today", () => {
    const product = tea();
    at("2026-11-02T06:00:00.000Z");
    receive(product.id, 10000, 1000);
    at("2026-11-03T06:00:00.000Z");
    sell(product.id, 3000);
    at("2026-11-07T06:00:00.000Z");

    const report = read(product.id, "2026-11-01", "2026-11-07");

    expect(report.closingMilli).toBe(kit.stock.onHand(product.id));
    expect(report.rows.at(-1)?.balanceMilli).toBe(7000);
  });

  it("values each movement at the cost stamped on it", () => {
    const product = tea();
    at("2026-11-02T06:00:00.000Z");
    receive(product.id, 10000, 1000);
    at("2026-11-03T06:00:00.000Z");
    receive(product.id, 10000, 2000);
    at("2026-11-04T06:00:00.000Z");
    sell(product.id, 1000);

    const report = read(product.id, "2026-11-01", "2026-11-07");

    expect(report.rows.map((row) => row.valuePaisa)).toEqual([10000, 20000, -1500]);
    expect(report.totals.valuePaisa).toBe(28500);
  });

  it("names the invoice, GRN, return and adjustment reason", () => {
    const product = tea();
    at("2026-11-02T06:00:00.000Z");
    const note = receive(product.id, 10000, 1000);
    at("2026-11-03T06:00:00.000Z");
    const sale = sell(product.id, 1000);
    at("2026-11-04T06:00:00.000Z");
    const returned = purchaseReturns.post(
      postPurchaseReturnInputSchema.parse({
        kind: "supplier",
        supplierId,
        reason: "damaged",
        notes: null,
        lines: [{ productId: product.id, qtyMilli: 2000 }],
      }),
    );
    if (!returned.ok) throw new Error("return failed");
    at("2026-11-05T06:00:00.000Z");
    inventory.adjustStock({
      mode: "change",
      productId: product.id,
      qtyMilli: -500,
      reason: "theft",
    });

    const report = read(product.id, "2026-11-01", "2026-11-07");

    expect(report.rows.map((row) => [row.type, row.reference])).toEqual([
      ["Receipt", `GRN ${note.grnNo}`],
      ["Sale", `Invoice ${sale.invoiceNo}`],
      ["Purchase return", `Return ${returned.purchaseReturn.returnNo}`],
      ["Damage", "Theft"],
    ]);
    expect(report.rows.every((row) => row.userName === "cashier name")).toBe(true);
  });

  it("matches the product's stock history, newest first, on type, quantity and cost", () => {
    const product = tea();
    at("2026-11-02T06:00:00.000Z");
    receive(product.id, 10000, 1000);
    at("2026-11-03T06:00:00.000Z");
    sell(product.id, 1000);

    const report = read(product.id, "2026-11-01", "2026-11-07");
    const history = inventory.history({ productId: product.id, limit: 50, offset: 0 });
    if (!history.ok) throw new Error("history refused");

    expect(
      history.movements.toReversed().map((movement) => [movement.qtyMilli, movement.createdAt]),
    ).toEqual(report.rows.map((row) => [row.qtyMilli, row.createdAt]));
    expect(history.movements.toReversed().map((movement) => movement.unitCostPaisa)).toEqual([
      1000, 1000,
    ]);
  });

  it("draws the range edges on Karachi midnight", () => {
    const product = tea();
    at("2026-11-02T18:59:59.000Z");
    receive(product.id, 1000, 1000);
    at("2026-11-02T19:00:00.000Z");
    receive(product.id, 2000, 1000);

    expect(read(product.id, "2026-11-02").rows.map((row) => row.qtyMilli)).toEqual([1000]);
    expect(read(product.id, "2026-11-03").rows.map((row) => row.qtyMilli)).toEqual([2000]);
    expect(read(product.id, "2026-11-03").openingMilli).toBe(1000);
  });

  it("returns no product and no rows for an unknown, deleted or other-store product", () => {
    const product = tea({ nameEn: "Gone", searchText: "gone" });
    kit.database.db
      .update(products)
      .set({ deletedAt: new Date() })
      .where(eq(products.id, product.id))
      .run();
    const otherStore = kit.database.db.insert(stores).values({ name: "Other" }).returning().get();
    const foreign = kit.addProduct({
      storeId: otherStore.id,
      nameEn: "Foreign",
      searchText: "foreign",
      categoryId: kit.database.db
        .insert(categories)
        .values({ storeId: otherStore.id, name: "Other" })
        .returning()
        .get().id,
    });

    for (const productId of [product.id, foreign.id, "01890000-0000-7000-8000-000000000000"]) {
      expect(read(productId, "2026-11-01", "2026-11-07")).toEqual({
        product: null,
        openingMilli: 0,
        closingMilli: 0,
        rows: [],
        totals: { valuePaisa: 0 },
      });
    }
  });

  it("refuses when signed out", async () => {
    const product = tea();
    kit.sessions.end();

    expect(() => read(product.id, "2026-11-01")).toThrow(UnauthenticatedError);
    await expect(
      service.exportStockMovements({
        productId: product.id,
        range: range("2026-11-01"),
        format: "csv",
      }),
    ).rejects.toThrow(UnauthenticatedError);
  });

  it("exports the CSV with the bare quantity and balance", async () => {
    const product = tea();
    at("2026-11-02T10:05:00.000Z");
    receive(product.id, 12000, 1050);

    await service.exportStockMovements({
      productId: product.id,
      range: range("2026-11-01", "2026-11-07"),
      format: "csv",
    });

    expect(chooseSavePath).toHaveBeenCalledWith(
      "stock-movements-2026-11-01-to-2026-11-07.csv",
      "csv",
    );
    const lines = readFileSync(
      join(kit.dir, "stock-movements-2026-11-01-to-2026-11-07.csv"),
      "utf8",
    )
      .slice(1)
      .split("\r\n");
    expect(lines[0]).toBe("Date,Type,Reference,Unit,Quantity,Balance,Value,By");
    expect(lines[1]).toMatch(/^2026-11-02 15:05,Receipt,GRN .+,pcs,12,12,126\.00,cashier name$/);
    expect(lines[2]).toBe("Total,,,,,,126.00,");
  });

  it("puts the product, range and balances on the PDF", async () => {
    const product = tea();
    at("2026-10-30T10:05:00.000Z");
    receive(product.id, 5000, 1000);
    at("2026-11-02T10:05:00.000Z");
    receive(product.id, 10000, 1000);

    await service.exportStockMovements({
      productId: product.id,
      range: range("2026-11-01", "2026-11-07"),
      format: "pdf",
    });

    const model = toPdf.mock.calls[0]?.[0];
    expect(model?.title).toBe("Stock movements");
    expect(model?.reference).toBe("Tea · 1 Nov 2026 – 7 Nov 2026");
    expect(model?.facts).toEqual([
      { label: "Times", value: "Asia/Karachi" },
      { label: "Opening balance", value: "5 pcs" },
      { label: "Closing balance", value: "15 pcs" },
    ]);
  });

  it("still writes an empty report when the product doesn't exist", async () => {
    const result = await service.exportStockMovements({
      productId: "01890000-0000-7000-8000-000000000000",
      range: range("2026-11-01"),
      format: "csv",
    });

    expect(result).toMatchObject({ ok: true, status: "saved" });
  });
});
