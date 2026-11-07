import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UnauthenticatedError } from "../auth/errors";
import { categories, products, stockMovements } from "../db/schema";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { createInventoryService } from "./inventory";

const UNKNOWN_ID = "01890000-0000-7000-8000-000000000000";

describe("createInventoryService", () => {
  let kit: CheckoutKit;
  let service: ReturnType<typeof createInventoryService>;
  let userId: string;
  let tick: number;

  beforeEach(() => {
    kit = createCheckoutKit();
    service = createInventoryService({
      database: kit.database,
      sessions: kit.sessions,
      stock: kit.stock,
    });
    userId = kit.signIn("cashier").id;
    tick = 0;
  });

  afterEach(() => kit.close());

  const product = (nameEn: string, overrides: Partial<typeof products.$inferInsert> = {}) =>
    kit.addProduct({ nameEn, searchText: nameEn.toLowerCase(), ...overrides });

  const move = (
    productId: string,
    type: typeof stockMovements.$inferInsert.type,
    qtyMilli: number,
    extra: Partial<typeof stockMovements.$inferInsert> = {},
  ) =>
    kit.database.db
      .insert(stockMovements)
      .values({
        storeId: kit.storeId,
        terminalId: kit.terminalId,
        productId,
        type,
        qtyMilli,
        unitCostPaisa: 0,
        actorUserId: userId,
        createdAt: new Date(Date.now() + 86_400_000 + tick++ * 1000),
        ...extra,
      })
      .returning()
      .get();

  const list = (query: Partial<Parameters<typeof service.list>[0]> = {}) =>
    service.list({ query: "", limit: 50, offset: 0, ...query });
  const history = (productId: string, limit = 50, offset = 0) =>
    service.history({ productId, limit, offset });
  const okHistory = (productId: string, limit = 50, offset = 0) => {
    const result = history(productId, limit, offset);
    if (!result.ok) throw new Error("refused");
    return result;
  };

  describe("list", () => {
    it("sums the ledger for weighed products and shows zero without movements", () => {
      const sugar = product("Sugar", { unit: "kg", costPaisa: 14333 });
      const milk = product("Milk", { unit: "litre", costPaisa: 20000 });
      const soap = product("Soap");
      move(sugar.id, "opening", 1234);
      move(sugar.id, "receipt", 766);
      move(sugar.id, "adjustment", -125, { reason: "correction" });
      move(milk.id, "opening", 2500);

      const byName = new Map(list().items.map((item) => [item.nameEn, item]));
      expect(byName.get("Sugar")).toMatchObject({ onHandMilli: 1875, costPaisa: 14333 });
      expect(byName.get("Milk")?.onHandMilli).toBe(2500);
      expect(byName.get("Soap")).toMatchObject({ onHandMilli: 0, stockValuePaisa: 0 });
      expect(soap.id).toBe(byName.get("Soap")?.id);
    });

    it("values positive, negative and zero stock", () => {
      const tea = product("Tea", { costPaisa: 105050 });
      const sugar = product("Sugar", { unit: "kg", costPaisa: 14333 });
      const soap = product("Soap", { costPaisa: 8500 });
      move(tea.id, "sale", -3000);
      move(sugar.id, "opening", 1250);
      move(soap.id, "opening", 2000);
      move(soap.id, "sale", -2000);

      const byName = new Map(list().items.map((item) => [item.nameEn, item]));
      expect(byName.get("Tea")?.stockValuePaisa).toBe(-315150);
      expect(byName.get("Sugar")?.stockValuePaisa).toBe(17916);
      expect(byName.get("Soap")?.stockValuePaisa).toBe(0);
    });

    it("revalues the same quantity when the cost changes", () => {
      const tea = product("Tea", { costPaisa: 1000 });
      move(tea.id, "opening", 4000);
      expect(list().items[0]).toMatchObject({ onHandMilli: 4000, stockValuePaisa: 4000 });

      kit.database.db
        .update(products)
        .set({ costPaisa: 1500 })
        .where(eq(products.id, tea.id))
        .run();
      expect(list().items[0]).toMatchObject({ onHandMilli: 4000, stockValuePaisa: 6000 });
    });

    it("searches, filters by category and pages with a total", () => {
      const snacks = kit.database.db
        .insert(categories)
        .values({ storeId: kit.storeId, name: "Snacks" })
        .returning()
        .get();
      product("Alpha");
      product("Beta", { categoryId: snacks.id });
      product("Gamma", { categoryId: snacks.id });

      expect(list({ query: "bet" }).items.map((item) => item.nameEn)).toEqual(["Beta"]);
      const filtered = list({ categoryId: snacks.id });
      expect(filtered.items.map((item) => item.nameEn)).toEqual(["Beta", "Gamma"]);
      expect(filtered.total).toBe(2);

      const page = list({ limit: 2, offset: 2 });
      expect(page.items.map((item) => item.nameEn)).toEqual(["Gamma"]);
      expect(page.total).toBe(3);
    });

    it("leaves out archived, deleted and system products", () => {
      product("Active");
      product("Archived", { isActive: false });
      product("Deleted", { deletedAt: new Date() });
      product("System", { isSystem: true });

      const result = list();
      expect(result.items.map((item) => item.nameEn)).toEqual(["Active"]);
      expect(result.total).toBe(1);
    });

    it("throws without a session", () => {
      kit.sessions.end();
      expect(() => list()).toThrow(UnauthenticatedError);
    });
  });

  describe("history", () => {
    it("lists newest first with user, source, reason and unit cost", () => {
      const sugar = product("Sugar", { unit: "kg", costPaisa: 14333 });
      kit.openShift();
      const draft = kit.billDrafts.addProduct({ productId: sugar.id, qtyMilli: 1250 });
      if (!draft.ok) throw new Error("add failed");
      const sold = kit.sales.complete({
        draftId: draft.bill.id,
        payments: [{ method: "cash", amountPaisa: 100000 }],
      });
      if (!sold.ok) throw new Error("sale failed");
      move(sugar.id, "adjustment", 500, { reason: "theft", unitCostPaisa: 14333 });

      const result = okHistory(sugar.id);
      expect(result.movements.map((row) => row.type)).toEqual(["adjustment", "sale"]);
      expect(result.movements[0]).toMatchObject({
        reason: "theft",
        unitCostPaisa: 14333,
        userName: "cashier name",
        source: null,
      });
      expect(result.movements[1]).toMatchObject({
        qtyMilli: -1250,
        unitCostPaisa: 14333,
        reason: null,
        source: `Invoice ${sold.sale.invoiceNo}`,
      });
      expect(result.product).toMatchObject({
        onHandMilli: -750,
        costPaisa: 14333,
        stockValuePaisa: -10750,
      });
    });

    it("pages with hasMore", () => {
      const tea = product("Tea");
      for (let index = 0; index < 5; index++) move(tea.id, "opening", 1000);

      const first = okHistory(tea.id, 2, 0);
      expect(first.movements).toHaveLength(2);
      expect(first.hasMore).toBe(true);

      const last = okHistory(tea.id, 2, 4);
      expect(last.movements).toHaveLength(1);
      expect(last.hasMore).toBe(false);

      expect(okHistory(tea.id, 5, 0).hasMore).toBe(false);
    });

    it("returns an empty page for a product without movements", () => {
      const tea = product("Tea");
      expect(okHistory(tea.id)).toMatchObject({ movements: [], hasMore: false });
    });

    it("refuses unknown, deleted and system products", () => {
      const deleted = product("Gone", { deletedAt: new Date() });
      const system = product("Misc", { isSystem: true });
      for (const id of [UNKNOWN_ID, deleted.id, system.id]) {
        expect(history(id)).toMatchObject({ ok: false, reason: "not-found" });
      }
    });

    it("throws without a session", () => {
      const tea = product("Tea");
      kit.sessions.end();
      expect(() => history(tea.id)).toThrow(UnauthenticatedError);
    });
  });
});
