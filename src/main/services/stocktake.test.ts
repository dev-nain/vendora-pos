import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UnauthenticatedError } from "../auth/errors";
import { openDatabase } from "../db/client";
import {
  auditLog,
  categories,
  products,
  stockMovements,
  stocktakeLines,
  stocktakes,
} from "../db/schema";
import { createCheckoutKit, scaleCode, type CheckoutKit } from "./checkout-test-kit";
import { createStockService } from "./stock";
import { createStocktakeService } from "./stocktake";

const UNKNOWN_ID = "01890000-0000-7000-8000-000000000000";

describe("createStocktakeService", () => {
  let kit: CheckoutKit;
  let service: ReturnType<typeof createStocktakeService>;
  let userId: string;
  let secondCategoryId: string;

  beforeEach(() => {
    kit = createCheckoutKit();
    service = createStocktakeService({
      database: kit.database,
      sessions: kit.sessions,
      stock: kit.stock,
      audit: kit.audit,
    });
    userId = kit.signIn("cashier").id;
    secondCategoryId = kit.database.db
      .insert(categories)
      .values({ storeId: kit.storeId, name: "Dairy" })
      .returning()
      .get().id;
  });

  afterEach(() => kit.close());

  const product = (nameEn: string, overrides: Partial<typeof products.$inferInsert> = {}) =>
    kit.addProduct({ nameEn, searchText: nameEn.toLowerCase(), ...overrides });

  const move = (productId: string, qtyMilli: number) =>
    kit.database.db
      .insert(stockMovements)
      .values({
        storeId: kit.storeId,
        terminalId: kit.terminalId,
        productId,
        type: "opening",
        qtyMilli,
        unitCostPaisa: 0,
        actorUserId: userId,
      })
      .run();

  const startFull = () => {
    const result = service.start({ scope: "full" });
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    return result.stocktake;
  };
  const linesOf = (stocktakeId: string, query = "", limit = 50, offset = 0) => {
    const result = service.lines({ stocktakeId, query, limit, offset });
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    return result;
  };
  const scanOf = (stocktakeId: string, barcode: string) => service.scan({ stocktakeId, barcode });
  const record = (stocktakeId: string, lineId: string, countedMilli: number) =>
    service.record({ stocktakeId, lineId, countedMilli });
  const lineRow = (lineId: string) =>
    kit.database.db.select().from(stocktakeLines).where(eq(stocktakeLines.id, lineId)).get()!;
  const lineIdOf = (stocktakeId: string, name: string) =>
    linesOf(stocktakeId).items.find((item) => item.nameEn === name)!.id;
  const found = (stocktakeId: string, barcode: string) => {
    const result = scanOf(stocktakeId, barcode);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    return result;
  };
  const recorded = (stocktakeId: string, lineId: string, countedMilli: number) => {
    const result = record(stocktakeId, lineId, countedMilli);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    return result;
  };
  const namesOf = (stocktakeId: string) => linesOf(stocktakeId).items.map((item) => item.nameEn);

  const reviewOf = (stocktakeId: string) => {
    const result = service.review({ stocktakeId });
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    return result.review;
  };
  const reviewLinesOf = (
    stocktakeId: string,
    filter: "all" | "variance" | "uncounted" = "all",
    limit = 50,
    offset = 0,
  ) => {
    const result = service.reviewLines({ stocktakeId, filter, limit, offset });
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    return result;
  };

  const auditRows = () =>
    kit.database.db.select().from(auditLog).where(eq(auditLog.action, "stocktake_post")).all();

  const sell = (productId: string, qtyMilli: number) => {
    kit.openShift();
    const bill = kit.billDrafts.addProduct({ productId, qtyMilli });
    if (!bill.ok) throw new Error("refused");
    const sale = kit.sales.complete({
      draftId: bill.bill.id,
      payments: [{ method: "cash", amountPaisa: bill.bill.totals.totalPaisa }],
    });
    if (!sale.ok) throw new Error("sale refused");
  };

  const linesResult = (stocktakeId: string) =>
    service.lines({ stocktakeId, query: "", limit: 5, offset: 0 });

  const post = (stocktakeId: string) => service.post({ stocktakeId });
  const posted = (stocktakeId: string) => {
    const result = post(stocktakeId);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    return result;
  };
  const movementsOf = (stocktakeId: string) =>
    kit.database.db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.sourceId, stocktakeId))
      .all();

  describe("start", () => {
    it("takes active products, and archived products with stock either way", () => {
      move(product("Active").id, 1000);
      move(product("Archived positive", { isActive: false }).id, 3000);
      move(product("Archived negative", { isActive: false }).id, -2000);
      product("Archived zero", { isActive: false });
      const netZero = product("Archived net zero", { isActive: false });
      move(netZero.id, 4000);
      move(netZero.id, -4000);
      product("Misc", { isSystem: true });
      product("Deleted", { deletedAt: new Date() });

      const stocktake = startFull();

      expect(namesOf(stocktake.id)).toEqual(["Active", "Archived negative", "Archived positive"]);
      expect(stocktake).toMatchObject({
        scope: "full",
        categoryName: null,
        startedByName: "cashier name",
        lineCount: 3,
        countedCount: 0,
      });
    });

    it("limits a category count to that category", () => {
      product("Tea");
      product("Milk", { categoryId: secondCategoryId });
      product("Old cream", { categoryId: secondCategoryId, isActive: false });
      move(product("Old butter", { categoryId: secondCategoryId, isActive: false }).id, 1000);

      const result = service.start({ scope: "category", categoryId: secondCategoryId });

      if (!result.ok) throw new Error("refused");
      expect(result.stocktake).toMatchObject({ scope: "category", categoryName: "Dairy" });
      expect(namesOf(result.stocktake.id)).toEqual(["Milk", "Old butter"]);
    });

    it("refuses an empty set and a missing or deleted category", () => {
      expect(service.start({ scope: "full" })).toMatchObject({
        ok: false,
        reason: "no-products",
      });
      product("Tea");
      expect(service.start({ scope: "category", categoryId: secondCategoryId })).toMatchObject({
        ok: false,
        reason: "no-products",
      });
      expect(service.start({ scope: "category", categoryId: UNKNOWN_ID })).toMatchObject({
        ok: false,
        reason: "category-not-found",
      });
      kit.database.db
        .update(categories)
        .set({ deletedAt: new Date() })
        .where(eq(categories.id, secondCategoryId))
        .run();
      expect(service.start({ scope: "category", categoryId: secondCategoryId })).toMatchObject({
        ok: false,
        reason: "category-not-found",
      });
    });

    it("counts a category that has only archived stock", () => {
      move(product("Old butter", { categoryId: secondCategoryId, isActive: false }).id, -500);
      const result = service.start({ scope: "category", categoryId: secondCategoryId });
      expect(result).toMatchObject({ ok: true, stocktake: { lineCount: 1 } });
    });

    it("stores terminal and store on the header and lines", () => {
      product("Tea");
      const stocktake = startFull();
      const header = kit.database.db.select().from(stocktakes).get()!;
      const line = kit.database.db.select().from(stocktakeLines).get()!;
      expect(header).toMatchObject({
        id: stocktake.id,
        storeId: kit.storeId,
        terminalId: kit.terminalId,
        startedBy: userId,
        status: "open",
      });
      expect(line).toMatchObject({
        storeId: kit.storeId,
        terminalId: kit.terminalId,
        stocktakeId: stocktake.id,
        expectedQtyMilli: null,
        countedQtyMilli: null,
        countedAt: null,
      });
    });

    it("does not change a line list when products are added afterwards", () => {
      product("Tea");
      const stocktake = startFull();
      product("Late");
      expect(namesOf(stocktake.id)).toEqual(["Tea"]);
    });

    it("inserts more lines than one chunk", () => {
      const template = product("Template");
      const { id: _id, ...rest } = template;
      kit.database.db
        .insert(products)
        .values(Array.from({ length: 1202 }, (_, i) => ({ ...rest, nameEn: `Item ${i}` })))
        .run();
      expect(startFull().lineCount).toBe(1203);
    });
  });

  describe("one open count", () => {
    it("refuses a second start and allows one after a cancel", () => {
      product("Tea");
      const first = startFull();

      expect(service.start({ scope: "full" })).toMatchObject({
        ok: false,
        reason: "already-open",
      });
      expect(service.cancel({ stocktakeId: first.id })).toEqual({ ok: true });

      const second = startFull();
      expect(second.id).not.toBe(first.id);
      expect(service.current()?.id).toBe(second.id);
    });

    it("rejects a direct second open insert in the database", () => {
      product("Tea");
      startFull();
      expect(() =>
        kit.database.db
          .insert(stocktakes)
          .values({
            storeId: kit.storeId,
            terminalId: kit.terminalId,
            scope: "full",
            startedBy: userId,
          })
          .run(),
      ).toThrow(/UNIQUE/);
    });

    it("returns null for current when no count is open", () => {
      expect(service.current()).toBeNull();
      product("Tea");
      const stocktake = startFull();
      expect(service.current()).toEqual(stocktake);
      service.cancel({ stocktakeId: stocktake.id });
      expect(service.current()).toBeNull();
    });
  });

  describe("lines", () => {
    it("searches by name, Urdu name and internal code, and orders by name", () => {
      product("Zeera", { nameUr: "زیرہ", searchText: "zeera زیرہ z01", internalCode: "Z01" });
      product("apple");
      product("Banana");
      const stocktake = startFull();

      expect(namesOf(stocktake.id)).toEqual(["apple", "Banana", "Zeera"]);
      expect(linesOf(stocktake.id, "zee").items.map((i) => i.nameEn)).toEqual(["Zeera"]);
      expect(linesOf(stocktake.id, "زیرہ").items.map((i) => i.nameEn)).toEqual(["Zeera"]);
      expect(linesOf(stocktake.id, "z01").items.map((i) => i.nameEn)).toEqual(["Zeera"]);
      expect(linesOf(stocktake.id, "nothing").total).toBe(0);
    });

    it("pages and reports the total", () => {
      for (const name of ["a", "b", "c", "d", "e"]) product(name);
      const stocktake = startFull();

      const first = linesOf(stocktake.id, "", 2, 0);
      const last = linesOf(stocktake.id, "", 2, 4);
      expect(first.items.map((i) => i.nameEn)).toEqual(["a", "b"]);
      expect(first.total).toBe(5);
      expect(last.items.map((i) => i.nameEn)).toEqual(["e"]);
    });

    it("shows on hand from the ledger, unit, status and category", () => {
      const sugar = product("Sugar", { unit: "kg" });
      move(sugar.id, 1250);
      move(product("Old", { isActive: false, categoryId: secondCategoryId }).id, -300);
      const stocktake = startFull();

      expect(linesOf(stocktake.id).items).toEqual([
        expect.objectContaining({
          nameEn: "Old",
          isActive: false,
          categoryName: "Dairy",
          onHandMilli: -300,
          countedMilli: null,
          countedAt: null,
        }),
        expect.objectContaining({
          nameEn: "Sugar",
          unit: "kg",
          isActive: true,
          onHandMilli: 1250,
        }),
      ]);
    });

    it("keeps an archived or deleted product's line in the list", () => {
      const tea = product("Tea");
      const stocktake = startFull();
      kit.database.db
        .update(products)
        .set({ isActive: false, deletedAt: new Date() })
        .where(eq(products.id, tea.id))
        .run();
      expect(namesOf(stocktake.id)).toEqual(["Tea"]);
    });

    it("refuses a count that is not open", () => {
      product("Tea");
      const stocktake = startFull();
      service.cancel({ stocktakeId: stocktake.id });
      expect(service.lines({ stocktakeId: stocktake.id, query: "", limit: 10, offset: 0 })).toEqual(
        { ok: false, reason: "not-open", message: expect.any(String) },
      );
      expect(
        service.lines({ stocktakeId: UNKNOWN_ID, query: "", limit: 10, offset: 0 }),
      ).toMatchObject({ ok: false, reason: "not-open" });
    });
  });

  describe("scan", () => {
    it("finds a line by product barcode and by pack barcode", () => {
      const tea = product("Tea");
      kit.addBarcode(tea.id, "8961000000011");
      kit.addBarcode(tea.id, "8961000000035", { packQtyMilli: 12000 });
      const stocktake = startFull();

      expect(found(stocktake.id, "8961000000011")).toMatchObject({
        packQtyMilli: 1000,
        line: { productId: tea.id, nameEn: "Tea" },
      });
      expect(found(stocktake.id, "8961000000035").packQtyMilli).toBe(12000);
    });

    it("finds a line by scale weight and price labels without keeping the label value", () => {
      const sugar = product("Sugar", { unit: "kg", internalCode: "00123" });
      const stocktake = startFull();

      const weight = found(stocktake.id, scaleCode("21", "00123", "01234"));
      const price = found(stocktake.id, scaleCode("22", "00123", "00250"));

      expect(weight).toMatchObject({ packQtyMilli: 1000, line: { productId: sugar.id } });
      expect(price.line.id).toBe(weight.line.id);
      expect(kit.database.db.select().from(stocktakeLines).get()).toMatchObject({
        expectedQtyMilli: null,
        countedQtyMilli: null,
      });
    });

    it("finds an archived product that is in the count", () => {
      const old = product("Old", { isActive: false });
      kit.addBarcode(old.id, "OLD1");
      move(old.id, 2000);
      const stocktake = startFull();
      expect(found(stocktake.id, "OLD1").line).toMatchObject({
        productId: old.id,
        isActive: false,
      });
    });

    it("refuses an unknown barcode, a product outside the scope and the Misc item", () => {
      product("Tea");
      const dairy = product("Milk", { categoryId: secondCategoryId });
      kit.addBarcode(dairy.id, "MILK1");
      const misc = product("Misc", { isSystem: true });
      kit.addBarcode(misc.id, "MISC1");
      const result = service.start({ scope: "category", categoryId: kit.categoryId });
      if (!result.ok) throw new Error("refused");
      const id = result.stocktake.id;

      expect(scanOf(id, "NOPE")).toMatchObject({
        ok: false,
        reason: "unknown-barcode",
        message: "No product has that barcode.",
      });
      expect(scanOf(id, "MILK1")).toMatchObject({
        ok: false,
        reason: "out-of-scope",
        message: "Milk isn't in this count.",
      });
      expect(scanOf(id, "MISC1")).toMatchObject({ ok: false, reason: "out-of-scope" });
    });

    it("refuses a product added after the count started", () => {
      product("Tea");
      const stocktake = startFull();
      const late = product("Late");
      kit.addBarcode(late.id, "LATE1");
      expect(scanOf(stocktake.id, "LATE1")).toMatchObject({ ok: false, reason: "out-of-scope" });
    });

    it("refuses a zero-value scale label and a closed count", () => {
      product("Sugar", { unit: "kg", internalCode: "00123" });
      const stocktake = startFull();
      expect(scanOf(stocktake.id, scaleCode("21", "00123", "00000"))).toMatchObject({
        ok: false,
        reason: "unknown-barcode",
      });
      service.cancel({ stocktakeId: stocktake.id });
      expect(scanOf(stocktake.id, "X")).toMatchObject({ ok: false, reason: "not-open" });
    });
  });

  describe("record", () => {
    it("stores milli-units on a kg line and whole pieces on a piece line", () => {
      product("Sugar", { unit: "kg" });
      product("Tea");
      const stocktake = startFull();
      const sugarLine = lineIdOf(stocktake.id, "Sugar");
      const teaLine = lineIdOf(stocktake.id, "Tea");

      expect(recorded(stocktake.id, sugarLine, 1250)).toMatchObject({
        line: { countedMilli: 1250 },
        countedCount: 1,
      });
      expect(recorded(stocktake.id, teaLine, 12000).countedCount).toBe(2);
      expect(lineRow(sugarLine).countedQtyMilli).toBe(1250);
      expect(lineRow(teaLine).countedQtyMilli).toBe(12000);
    });

    it("stores zero as a count", () => {
      product("Tea");
      const stocktake = startFull();
      const id = lineIdOf(stocktake.id, "Tea");
      expect(recorded(stocktake.id, id, 0).line.countedMilli).toBe(0);
      expect(lineRow(id)).toMatchObject({ countedQtyMilli: 0, expectedQtyMilli: 0 });
      expect(service.current()?.countedCount).toBe(1);
    });

    it("refuses a fraction of a piece and stores nothing", () => {
      product("Tea");
      const stocktake = startFull();
      const id = lineIdOf(stocktake.id, "Tea");
      expect(record(stocktake.id, id, 1500)).toMatchObject({ ok: false, reason: "whole-units" });
      expect(lineRow(id).countedQtyMilli).toBeNull();
    });

    it("takes the expected quantity from the ledger at count time", () => {
      const tea = product("Tea");
      move(tea.id, 40000);
      const counted = new Date("2026-11-06T10:15:00.000Z");
      service = createStocktakeService({
        database: kit.database,
        sessions: kit.sessions,
        stock: kit.stock,
        audit: kit.audit,
        now: () => counted,
      });
      const stocktake = startFull();
      const id = lineIdOf(stocktake.id, "Tea");
      move(tea.id, -5000);

      const result = recorded(stocktake.id, id, 12000);

      expect(result.line.countedAt).toBe(counted.toISOString());
      expect(result.line.onHandMilli).toBe(35000);
      expect(lineRow(id)).toMatchObject({
        expectedQtyMilli: 35000,
        countedQtyMilli: 12000,
        countedAt: counted,
      });
    });

    it("overwrites the count, expected quantity and time when recorded again", () => {
      const tea = product("Tea");
      move(tea.id, 10000);
      let clock = new Date("2026-11-06T10:00:00.000Z");
      service = createStocktakeService({
        database: kit.database,
        sessions: kit.sessions,
        stock: kit.stock,
        audit: kit.audit,
        now: () => clock,
      });
      const stocktake = startFull();
      const id = lineIdOf(stocktake.id, "Tea");
      recorded(stocktake.id, id, 7000);

      move(tea.id, -2000);
      clock = new Date("2026-11-06T10:30:00.000Z");
      const again = recorded(stocktake.id, id, 8000);

      expect(again.countedCount).toBe(1);
      expect(lineRow(id)).toMatchObject({
        expectedQtyMilli: 8000,
        countedQtyMilli: 8000,
        countedAt: clock,
      });
    });

    it("refuses an unknown line, a line of another count and a closed count", () => {
      product("Tea");
      const first = startFull();
      const firstLine = lineIdOf(first.id, "Tea");
      expect(record(first.id, UNKNOWN_ID, 1000)).toMatchObject({ ok: false, reason: "not-found" });
      service.cancel({ stocktakeId: first.id });
      const second = startFull();

      expect(record(second.id, firstLine, 1000)).toMatchObject({ ok: false, reason: "not-found" });
      expect(record(first.id, firstLine, 1000)).toMatchObject({ ok: false, reason: "not-open" });
      expect(lineRow(firstLine).countedQtyMilli).toBeNull();
    });

    it("writes no stock movement", () => {
      const tea = product("Tea");
      move(tea.id, 10000);
      const stocktake = startFull();
      recorded(stocktake.id, lineIdOf(stocktake.id, "Tea"), 3000);
      expect(kit.database.db.select().from(stockMovements).all()).toHaveLength(1);
      expect(kit.stock.onHand(tea.id)).toBe(10000);
    });

    it("keeps expected and counted time when a sale completes after the count", () => {
      const tea = product("Tea", { salePricePaisa: 10000 });
      move(tea.id, 10000);
      const stocktake = startFull();
      const id = lineIdOf(stocktake.id, "Tea");
      recorded(stocktake.id, id, 9000);
      const before = lineRow(id);

      kit.openShift();
      const bill = kit.billDrafts.addProduct({ productId: tea.id, qtyMilli: 2000 });
      if (!bill.ok) throw new Error("refused");
      const sale = kit.sales.complete({
        draftId: bill.bill.id,
        payments: [{ method: "cash", amountPaisa: bill.bill.totals.totalPaisa }],
      });
      expect(sale.ok).toBe(true);

      expect(lineRow(id)).toMatchObject({
        expectedQtyMilli: before.expectedQtyMilli,
        countedAt: before.countedAt,
      });
      expect(linesOf(stocktake.id).items[0]).toMatchObject({
        onHandMilli: 8000,
        countedMilli: 9000,
      });
    });
  });

  describe("resume after restart", () => {
    it("reads the open count and its saved counts from a second connection", () => {
      product("Tea");
      product("Milk");
      const stocktake = startFull();
      const id = linesOf(stocktake.id).items.find((item) => item.nameEn === "Tea")!.id;
      const saved = service.record({ stocktakeId: stocktake.id, lineId: id, countedMilli: 4000 });
      expect(saved.ok).toBe(true);

      const reopened = openDatabase(join(kit.dir, "vendora.db"));
      try {
        const resumed = createStocktakeService({
          database: reopened,
          sessions: kit.sessions,
          stock: createStockService({ database: reopened, audit: kit.audit }),
          audit: kit.audit,
        });
        expect(resumed.current()).toMatchObject({
          id: stocktake.id,
          lineCount: 2,
          countedCount: 1,
        });
        const result = resumed.lines({
          stocktakeId: stocktake.id,
          query: "tea",
          limit: 10,
          offset: 0,
        });
        expect(result).toMatchObject({ ok: true, items: [{ countedMilli: 4000 }] });
      } finally {
        reopened.sqlite.close();
      }
    });
  });

  describe("cancel", () => {
    it("leaves stock and lines as they were", () => {
      const tea = product("Tea");
      move(tea.id, 5000);
      const stocktake = startFull();
      const movementsBefore = kit.database.db.select().from(stockMovements).all();

      expect(service.cancel({ stocktakeId: stocktake.id })).toEqual({ ok: true });

      expect(kit.database.db.select().from(stockMovements).all()).toEqual(movementsBefore);
      expect(kit.stock.onHand(tea.id)).toBe(5000);
      expect(kit.database.db.select().from(stocktakeLines).all()).toHaveLength(1);
      expect(kit.database.db.select().from(stocktakes).get()?.status).toBe("cancelled");
    });

    it("refuses a count that is already closed or unknown", () => {
      product("Tea");
      const stocktake = startFull();
      service.cancel({ stocktakeId: stocktake.id });
      expect(service.cancel({ stocktakeId: stocktake.id })).toMatchObject({
        ok: false,
        reason: "not-open",
      });
      expect(service.cancel({ stocktakeId: UNKNOWN_ID })).toMatchObject({
        ok: false,
        reason: "not-open",
      });
    });
  });

  describe("review", () => {
    it("takes variance against the quantity on hand when the line was counted", () => {
      const tea = product("Tea", { costPaisa: 1000 });
      move(tea.id, 20000);
      const stocktake = startFull();
      recorded(stocktake.id, lineIdOf(stocktake.id, "Tea"), 20000);
      move(tea.id, -3000);

      expect(reviewLinesOf(stocktake.id).items[0]).toMatchObject({
        expectedMilli: 20000,
        countedMilli: 20000,
        varianceMilli: 0,
        varianceValuePaisa: 0,
      });
      expect(reviewOf(stocktake.id)).toMatchObject({
        varianceLineCount: 0,
        netValuePaisa: 0,
      });
    });

    it("reports quantity and value variance with totals that add up", () => {
      const tapal = product("Tapal", { costPaisa: 105050 });
      const sugar = product("Sugar", { unit: "kg", costPaisa: 14333 });
      product("Lux", { costPaisa: 8500 });
      product("Rice", { costPaisa: 25000 });
      move(tapal.id, 12000);
      move(sugar.id, 10000);
      const stocktake = startFull();
      recorded(stocktake.id, lineIdOf(stocktake.id, "Tapal"), 11000);
      recorded(stocktake.id, lineIdOf(stocktake.id, "Sugar"), 9250);
      recorded(stocktake.id, lineIdOf(stocktake.id, "Lux"), 2000);

      const items = reviewLinesOf(stocktake.id).items;
      expect(
        items.map((item) => [item.nameEn, item.varianceMilli, item.varianceValuePaisa]),
      ).toEqual([
        ["Lux", 2000, 17000],
        ["Rice", null, null],
        ["Sugar", -750, -10750],
        ["Tapal", -1000, -105050],
      ]);
      expect(reviewOf(stocktake.id)).toMatchObject({
        status: "open",
        lineCount: 4,
        countedCount: 3,
        skippedCount: 1,
        varianceLineCount: 3,
        shortValuePaisa: -115800,
        surplusValuePaisa: 17000,
        netValuePaisa: -98800,
        postedAt: null,
        postedByName: null,
      });
    });

    it("shows live on hand for an uncounted line of an open count", () => {
      const tea = product("Tea");
      move(tea.id, 7000);
      const stocktake = startFull();

      expect(reviewLinesOf(stocktake.id, "uncounted").items[0]).toMatchObject({
        expectedMilli: 7000,
        countedMilli: null,
        varianceMilli: null,
        varianceValuePaisa: null,
      });
    });

    it("filters to variances and to uncounted lines, and pages", () => {
      const tea = product("Tea");
      const milk = product("Milk");
      product("Rice");
      move(tea.id, 5000);
      move(milk.id, 5000);
      const stocktake = startFull();
      recorded(stocktake.id, lineIdOf(stocktake.id, "Tea"), 4000);
      recorded(stocktake.id, lineIdOf(stocktake.id, "Milk"), 5000);

      const variance = reviewLinesOf(stocktake.id, "variance");
      expect(variance.items.map((item) => item.nameEn)).toEqual(["Tea"]);
      expect(variance.total).toBe(1);
      const uncounted = reviewLinesOf(stocktake.id, "uncounted");
      expect(uncounted.items.map((item) => item.nameEn)).toEqual(["Rice"]);
      const page = reviewLinesOf(stocktake.id, "all", 1, 1);
      expect(page.items.map((item) => item.nameEn)).toEqual(["Rice"]);
      expect(page.total).toBe(3);
    });

    it("values an open count at the live cost", () => {
      const tea = product("Tea", { costPaisa: 1000 });
      move(tea.id, 5000);
      const stocktake = startFull();
      recorded(stocktake.id, lineIdOf(stocktake.id, "Tea"), 4000);
      expect(reviewOf(stocktake.id).netValuePaisa).toBe(-1000);

      kit.database.db
        .update(products)
        .set({ costPaisa: 2000 })
        .where(eq(products.id, tea.id))
        .run();

      expect(reviewOf(stocktake.id).netValuePaisa).toBe(-2000);
      expect(reviewLinesOf(stocktake.id).items[0]?.varianceValuePaisa).toBe(-2000);
    });

    it("shows a cancelled count with quantities and no values", () => {
      const tea = product("Tea", { costPaisa: 1000 });
      move(tea.id, 5000);
      product("Rice");
      const stocktake = startFull();
      recorded(stocktake.id, lineIdOf(stocktake.id, "Tea"), 4000);
      service.cancel({ stocktakeId: stocktake.id });

      expect(reviewOf(stocktake.id)).toMatchObject({
        status: "cancelled",
        varianceLineCount: 1,
        skippedCount: 1,
        shortValuePaisa: null,
        surplusValuePaisa: null,
        netValuePaisa: null,
      });
      const items = reviewLinesOf(stocktake.id).items;
      expect(items.map((item) => [item.nameEn, item.expectedMilli, item.varianceMilli])).toEqual([
        ["Rice", null, null],
        ["Tea", 5000, -1000],
      ]);
      expect(items.every((item) => item.varianceValuePaisa === null)).toBe(true);
    });

    it("answers not-found for an unknown count", () => {
      expect(service.review({ stocktakeId: UNKNOWN_ID })).toMatchObject({
        ok: false,
        reason: "not-found",
      });
      expect(
        service.reviewLines({ stocktakeId: UNKNOWN_ID, filter: "all", limit: 10, offset: 0 }),
      ).toMatchObject({ ok: false, reason: "not-found" });
    });
  });

  describe("listPast", () => {
    it("lists cancelled counts newest first and leaves out the open one", () => {
      product("Tea");
      let clock = new Date("2026-11-01T10:00:00.000Z");
      service = createStocktakeService({
        database: kit.database,
        sessions: kit.sessions,
        stock: kit.stock,
        audit: kit.audit,
        now: () => clock,
      });
      const first = startFull();
      service.cancel({ stocktakeId: first.id });
      clock = new Date("2026-11-02T10:00:00.000Z");
      const second = service.start({ scope: "category", categoryId: kit.categoryId });
      if (!second.ok) throw new Error("refused");
      service.cancel({ stocktakeId: second.stocktake.id });
      clock = new Date("2026-11-03T10:00:00.000Z");
      startFull();

      const result = service.listPast({ limit: 10, offset: 0 });

      expect(result.total).toBe(2);
      expect(result.items.map((item) => [item.id, item.status, item.scope, item.date])).toEqual([
        [second.stocktake.id, "cancelled", "category", "2026-11-02T10:00:00.000Z"],
        [first.id, "cancelled", "full", "2026-11-01T10:00:00.000Z"],
      ]);
      expect(result.items[0]?.categoryName).toBe(second.stocktake.categoryName);
      expect(service.listPast({ limit: 1, offset: 1 }).items.map((item) => item.id)).toEqual([
        first.id,
      ]);
    });
  });

  describe("post", () => {
    it("writes no adjustment when stock moved after the count: counted 20, then sold 3", () => {
      const tea = product("Tea");
      move(tea.id, 20000);
      const stocktake = startFull();
      recorded(stocktake.id, lineIdOf(stocktake.id, "Tea"), 20000);
      sell(tea.id, 3000);

      expect(posted(stocktake.id)).toMatchObject({ adjustmentCount: 0, netValuePaisa: 0 });

      expect(movementsOf(stocktake.id)).toHaveLength(0);
      expect(kit.stock.onHand(tea.id)).toBe(17000);
    });

    it("keeps movements made after the count on top of the counted quantity", () => {
      const tea = product("Tea");
      move(tea.id, 20000);
      const stocktake = startFull();
      recorded(stocktake.id, lineIdOf(stocktake.id, "Tea"), 18000);
      move(tea.id, -3000);
      move(tea.id, 5000);

      expect(posted(stocktake.id)).toMatchObject({ adjustmentCount: 1 });

      expect(movementsOf(stocktake.id)).toMatchObject([
        { type: "stocktake", qtyMilli: -2000, reason: null, sourceType: "stocktake" },
      ]);
      expect(kit.stock.onHand(tea.id)).toBe(20000);
    });

    it("counts stock moved before the count as part of expected", () => {
      const tea = product("Tea");
      move(tea.id, 20000);
      move(tea.id, -5000);
      const stocktake = startFull();
      recorded(stocktake.id, lineIdOf(stocktake.id, "Tea"), 16000);

      posted(stocktake.id);

      expect(movementsOf(stocktake.id).map((m) => m.qtyMilli)).toEqual([1000]);
      expect(kit.stock.onHand(tea.id)).toBe(16000);
    });

    it("writes nothing for an uncounted line and never treats it as zero", () => {
      const tea = product("Tea");
      const rice = product("Rice");
      move(tea.id, 5000);
      move(rice.id, 8000);
      const stocktake = startFull();
      recorded(stocktake.id, lineIdOf(stocktake.id, "Tea"), 4000);

      expect(posted(stocktake.id)).toMatchObject({ adjustmentCount: 1, skippedCount: 1 });

      expect(kit.stock.onHand(rice.id)).toBe(8000);
      expect(movementsOf(stocktake.id).map((m) => m.productId)).toEqual([tea.id]);
      expect(JSON.parse(auditRows()[0]!.details!)).toMatchObject({ skippedCount: 1 });
    });

    it("posts a count with no variance without any movement", () => {
      const tea = product("Tea");
      move(tea.id, 5000);
      const stocktake = startFull();
      recorded(stocktake.id, lineIdOf(stocktake.id, "Tea"), 5000);

      expect(posted(stocktake.id)).toMatchObject({ adjustmentCount: 0 });

      expect(movementsOf(stocktake.id)).toHaveLength(0);
      expect(kit.database.db.select().from(stocktakes).get()?.status).toBe("posted");
    });

    it("refuses to post with nothing counted and writes nothing", () => {
      product("Tea");
      const stocktake = startFull();

      expect(post(stocktake.id)).toMatchObject({ ok: false, reason: "nothing-counted" });

      expect(kit.database.db.select().from(stocktakes).get()?.status).toBe("open");
      expect(auditRows()).toHaveLength(0);
    });

    it("refuses a second post and writes nothing more", () => {
      const tea = product("Tea");
      move(tea.id, 5000);
      const stocktake = startFull();
      recorded(stocktake.id, lineIdOf(stocktake.id, "Tea"), 4000);
      posted(stocktake.id);

      expect(post(stocktake.id)).toMatchObject({ ok: false, reason: "not-open" });

      expect(movementsOf(stocktake.id)).toHaveLength(1);
      expect(auditRows()).toHaveLength(1);
      expect(kit.stock.onHand(tea.id)).toBe(4000);
    });

    it("refuses an unknown count", () => {
      expect(post(UNKNOWN_ID)).toMatchObject({ ok: false, reason: "not-open" });
    });

    it("rolls back every write when a later movement fails, and a retry succeeds", () => {
      const tea = product("Tea");
      const rice = product("Rice");
      move(tea.id, 5000);
      move(rice.id, 5000);
      let calls = 0;
      const failing = createStocktakeService({
        database: kit.database,
        sessions: kit.sessions,
        audit: kit.audit,
        stock: {
          ...kit.stock,
          record: (tx, input) => {
            calls += 1;
            if (calls === 2) throw new Error("disk full");
            return kit.stock.record(tx, input);
          },
        },
      });
      const stocktake = startFull();
      recorded(stocktake.id, lineIdOf(stocktake.id, "Tea"), 4000);
      recorded(stocktake.id, lineIdOf(stocktake.id, "Rice"), 3000);

      expect(() => failing.post({ stocktakeId: stocktake.id })).toThrow("disk full");

      expect(movementsOf(stocktake.id)).toHaveLength(0);
      expect(kit.database.db.select().from(stocktakes).get()?.status).toBe("open");
      expect(
        kit.database.db
          .select()
          .from(stocktakeLines)
          .all()
          .every((line) => line.unitCostPaisa === null),
      ).toBe(true);
      expect(auditRows()).toHaveLength(0);

      expect(posted(stocktake.id)).toMatchObject({ adjustmentCount: 2 });
      expect(kit.stock.onHand(tea.id)).toBe(4000);
      expect(kit.stock.onHand(rice.id)).toBe(3000);
    });

    it("rolls back the movements when the audit row cannot be written", () => {
      const tea = product("Tea");
      move(tea.id, 5000);
      const failing = createStocktakeService({
        database: kit.database,
        sessions: kit.sessions,
        stock: kit.stock,
        audit: {
          record: (input, tx) => {
            if (input.action === "stocktake_post") throw new Error("audit down");
            return kit.audit.record(input, tx);
          },
        },
      });
      const stocktake = startFull();
      recorded(stocktake.id, lineIdOf(stocktake.id, "Tea"), 4000);

      expect(() => failing.post({ stocktakeId: stocktake.id })).toThrow("audit down");

      expect(movementsOf(stocktake.id)).toHaveLength(0);
      expect(kit.stock.onHand(tea.id)).toBe(5000);
      expect(kit.database.db.select().from(stocktakes).get()?.status).toBe("open");
    });

    it("posts a line whose product was archived or deleted after the count started", () => {
      const lux = product("Lux");
      const old = product("Old");
      move(lux.id, 5000);
      move(old.id, 5000);
      const stocktake = startFull();
      recorded(stocktake.id, lineIdOf(stocktake.id, "Lux"), 4000);
      recorded(stocktake.id, lineIdOf(stocktake.id, "Old"), 6000);
      kit.database.db
        .update(products)
        .set({ isActive: false })
        .where(eq(products.id, lux.id))
        .run();
      kit.database.db
        .update(products)
        .set({ deletedAt: new Date() })
        .where(eq(products.id, old.id))
        .run();

      expect(posted(stocktake.id)).toMatchObject({ adjustmentCount: 2 });

      expect(kit.stock.onHand(lux.id)).toBe(4000);
      expect(kit.stock.onHand(old.id)).toBe(6000);
    });

    it("freezes the cost, matches review to the audit totals and stamps the movements", () => {
      const tapal = product("Tapal", { costPaisa: 105050 });
      product("Lux", { costPaisa: 8500 });
      move(tapal.id, 12000);
      const stocktake = startFull();
      recorded(stocktake.id, lineIdOf(stocktake.id, "Tapal"), 11000);
      recorded(stocktake.id, lineIdOf(stocktake.id, "Lux"), 2000);
      const before = service.review({ stocktakeId: stocktake.id });

      const result = posted(stocktake.id);

      const after = service.review({ stocktakeId: stocktake.id });
      if (!before.ok || !after.ok) throw new Error("refused");
      expect(result.netValuePaisa).toBe(-88050);
      expect(after.review).toMatchObject({
        status: "posted",
        postedByName: "cashier name",
        shortValuePaisa: before.review.shortValuePaisa,
        surplusValuePaisa: before.review.surplusValuePaisa,
        netValuePaisa: before.review.netValuePaisa,
      });
      expect(JSON.parse(auditRows()[0]!.details!)).toMatchObject({
        shortValuePaisa: -105050,
        surplusValuePaisa: 17000,
        netValuePaisa: -88050,
        adjustmentCount: 2,
        countedCount: 2,
        lineCount: 2,
        scope: "full",
      });
      expect(auditRows()[0]).toMatchObject({
        actorUserId: userId,
        entityType: "stocktake",
        entityId: stocktake.id,
      });
      const frozen = new Map(
        kit.database.db
          .select()
          .from(stocktakeLines)
          .all()
          .map((line) => [line.productId, line.unitCostPaisa]),
      );
      expect(frozen.get(tapal.id)).toBe(105050);
      for (const movement of movementsOf(stocktake.id)) {
        expect(movement.unitCostPaisa).toBe(frozen.get(movement.productId));
        expect(movement.actorUserId).toBe(userId);
      }
    });

    it("keeps a posted count's values after a later cost edit", () => {
      const tea = product("Tea", { costPaisa: 1000 });
      move(tea.id, 5000);
      const stocktake = startFull();
      recorded(stocktake.id, lineIdOf(stocktake.id, "Tea"), 4000);
      posted(stocktake.id);

      kit.database.db
        .update(products)
        .set({ costPaisa: 9000 })
        .where(eq(products.id, tea.id))
        .run();

      expect(service.review({ stocktakeId: stocktake.id })).toMatchObject({
        ok: true,
        review: { netValuePaisa: -1000 },
      });
      expect(reviewLinesOf(stocktake.id).items).toMatchObject([
        { varianceMilli: -1000, varianceValuePaisa: -1000 },
      ]);
    });

    it("lists the posted count in the past counts with its posted date", () => {
      const tea = product("Tea");
      move(tea.id, 5000);
      const postedAt = new Date("2026-11-05T09:00:00.000Z");
      service = createStocktakeService({
        database: kit.database,
        sessions: kit.sessions,
        stock: kit.stock,
        audit: kit.audit,
        now: () => postedAt,
      });
      const stocktake = startFull();
      recorded(stocktake.id, lineIdOf(stocktake.id, "Tea"), 4000);
      posted(stocktake.id);

      expect(service.listPast({ limit: 5, offset: 0 }).items).toMatchObject([
        { id: stocktake.id, status: "posted", date: postedAt.toISOString() },
      ]);
    });

    it("leaves a posted count read-only", () => {
      const tea = product("Tea");
      move(tea.id, 5000);
      kit.addBarcode(tea.id, "6001");
      const stocktake = startFull();
      const lineId = lineIdOf(stocktake.id, "Tea");
      recorded(stocktake.id, lineId, 4000);
      posted(stocktake.id);
      const lineBefore = lineRow(lineId);

      expect(record(stocktake.id, lineId, 1000)).toMatchObject({ ok: false, reason: "not-open" });
      expect(scanOf(stocktake.id, "6001")).toMatchObject({ ok: false, reason: "not-open" });
      expect(linesResult(stocktake.id)).toMatchObject({ ok: false, reason: "not-open" });
      expect(service.cancel({ stocktakeId: stocktake.id })).toMatchObject({
        ok: false,
        reason: "not-open",
      });

      expect(lineRow(lineId)).toEqual(lineBefore);
      expect(kit.database.db.select().from(stocktakes).get()?.status).toBe("posted");
    });
  });

  describe("without a session", () => {
    it("throws UnauthenticatedError for every method", () => {
      kit.sessions.end();
      expect(() => service.current()).toThrow(UnauthenticatedError);
      expect(() => service.start({ scope: "full" })).toThrow(UnauthenticatedError);
      expect(() =>
        service.lines({ stocktakeId: UNKNOWN_ID, query: "", limit: 1, offset: 0 }),
      ).toThrow(UnauthenticatedError);
      expect(() => service.cancel({ stocktakeId: UNKNOWN_ID })).toThrow(UnauthenticatedError);
      expect(() => service.review({ stocktakeId: UNKNOWN_ID })).toThrow(UnauthenticatedError);
      expect(() =>
        service.reviewLines({ stocktakeId: UNKNOWN_ID, filter: "all", limit: 1, offset: 0 }),
      ).toThrow(UnauthenticatedError);
      expect(() => service.listPast({ limit: 1, offset: 0 })).toThrow(UnauthenticatedError);
      expect(() => service.post({ stocktakeId: UNKNOWN_ID })).toThrow(UnauthenticatedError);
    });
  });
});
