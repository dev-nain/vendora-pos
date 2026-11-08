import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentModel } from "../../shared/document";
import type { ReportExportFormat } from "../../shared/reports";
import { UnauthenticatedError } from "../auth/errors";
import { categories, products, stockMovements } from "../db/schema";
import type { DocumentRenderer } from "../documents/document-window";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { createInventoryService } from "./inventory";
import { createReportsService } from "./reports";

const NOW = new Date("2026-11-07T10:05:00.000Z");

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
