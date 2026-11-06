import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UnauthenticatedError } from "../auth/errors";
import { categories, products, stockMovements, stocktakeLines, stocktakes } from "../db/schema";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
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
  const namesOf = (stocktakeId: string) => linesOf(stocktakeId).items.map((item) => item.nameEn);

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

  describe("without a session", () => {
    it("throws UnauthenticatedError for every method", () => {
      kit.sessions.end();
      expect(() => service.current()).toThrow(UnauthenticatedError);
      expect(() => service.start({ scope: "full" })).toThrow(UnauthenticatedError);
      expect(() =>
        service.lines({ stocktakeId: UNKNOWN_ID, query: "", limit: 1, offset: 0 }),
      ).toThrow(UnauthenticatedError);
      expect(() => service.cancel({ stocktakeId: UNKNOWN_ID })).toThrow(UnauthenticatedError);
    });
  });
});
