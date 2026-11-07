import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { categories, products, stockMovements } from "../db/schema";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { lowStockProducts } from "./low-stock";

type Query = Parameters<typeof lowStockProducts>[2];

describe("lowStockProducts", () => {
  let kit: CheckoutKit;
  let userId: string;

  beforeEach(() => {
    kit = createCheckoutKit();
    userId = kit.signIn("cashier").id;
  });

  afterEach(() => kit.close());

  const product = (nameEn: string, overrides: Partial<typeof products.$inferInsert> = {}) =>
    kit.addProduct({
      nameEn,
      searchText: nameEn.toLowerCase(),
      lowStockThresholdMilli: 5000,
      ...overrides,
    });

  const move = (productId: string, qtyMilli: number) =>
    kit.database.db
      .insert(stockMovements)
      .values({
        storeId: kit.storeId,
        terminalId: kit.terminalId,
        productId,
        type: "adjustment",
        reason: "correction",
        qtyMilli,
        unitCostPaisa: 0,
        actorUserId: userId,
      })
      .run();

  const low = (query: Partial<Query> = {}) =>
    lowStockProducts(kit.database, kit.storeId, { limit: 50, offset: 0, ...query });
  const names = (query: Partial<Query> = {}) => low(query).items.map((item) => item.nameEn);

  it("lists products at or below threshold and not above", () => {
    const at = product("At");
    const below = product("Below");
    const above = product("Above");
    move(at.id, 5000);
    move(below.id, 3000);
    move(above.id, 5001);

    const byName = new Map(low().items.map((item) => [item.nameEn, item]));
    expect(byName.get("At")).toMatchObject({ onHandMilli: 5000, shortfallMilli: 0 });
    expect(byName.get("Below")).toMatchObject({
      onHandMilli: 3000,
      thresholdMilli: 5000,
      shortfallMilli: 2000,
    });
    expect(byName.has("Above")).toBe(false);
  });

  it("skips products without a threshold, even at negative stock", () => {
    const tea = product("Tea", { lowStockThresholdMilli: null });
    move(tea.id, -1000);
    expect(low()).toEqual({ items: [], total: 0 });
  });

  it("skips archived, soft-deleted and system products", () => {
    product("Archived", { isActive: false });
    product("Deleted", { deletedAt: new Date() });
    product("System", { isSystem: true });
    product("Live");
    expect(names()).toEqual(["Live"]);
  });

  it("sums weighed products in milli-units", () => {
    const sugar = product("Sugar", { unit: "kg", lowStockThresholdMilli: 2500 });
    const flour = product("Flour", { unit: "kg", lowStockThresholdMilli: 2500 });
    move(sugar.id, 1234);
    move(sugar.id, 766);
    move(sugar.id, -1125);
    move(flour.id, 2501);

    expect(low().items).toEqual([
      expect.objectContaining({
        nameEn: "Sugar",
        onHandMilli: 875,
        thresholdMilli: 2500,
        shortfallMilli: 1625,
      }),
    ]);
  });

  it("lists negative stock with a shortfall above the threshold", () => {
    const tea = product("Tea");
    move(tea.id, -3000);
    expect(low().items[0]).toMatchObject({ onHandMilli: -3000, shortfallMilli: 8000 });
  });

  it("applies a threshold of zero", () => {
    product("Zero", { lowStockThresholdMilli: 0 });
    const negative = product("Negative", { lowStockThresholdMilli: 0 });
    const positive = product("Positive", { lowStockThresholdMilli: 0 });
    move(negative.id, -1000);
    move(positive.id, 1);
    expect(names()).toEqual(["Negative", "Zero"]);
    expect(low().items[0]).toMatchObject({ onHandMilli: -1000, shortfallMilli: 1000 });
  });

  it("counts a product with no movements as zero on hand", () => {
    product("Tea");
    expect(low().items[0]).toMatchObject({ onHandMilli: 0, shortfallMilli: 5000 });
  });

  it("filters by category", () => {
    const snacks = kit.database.db
      .insert(categories)
      .values({ storeId: kit.storeId, name: "Snacks" })
      .returning()
      .get();
    product("Alpha");
    product("Beta", { categoryId: snacks.id });
    expect(names({ categoryId: snacks.id })).toEqual(["Beta"]);
  });

  it("orders by name ignoring case and pages with a total", () => {
    product("banana");
    product("Apple");
    product("cherry");
    expect(names()).toEqual(["Apple", "banana", "cherry"]);
    const page = low({ limit: 2, offset: 2 });
    expect(page.items.map((item) => item.nameEn)).toEqual(["cherry"]);
    expect(page.total).toBe(3);
    expect(low({ limit: 2, offset: 10 })).toEqual({ items: [], total: 3 });
  });
});
