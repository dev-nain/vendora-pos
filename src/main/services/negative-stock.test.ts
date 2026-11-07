import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { products, stockMovements } from "../db/schema";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { listNegativeStock } from "./negative-stock";

describe("listNegativeStock", () => {
  let kit: CheckoutKit;
  let userId: string;
  let tick: number;

  beforeEach(() => {
    kit = createCheckoutKit();
    userId = kit.signIn("cashier").id;
    tick = 0;
  });

  afterEach(() => kit.close());

  const product = (nameEn: string, overrides: Partial<typeof products.$inferInsert> = {}) =>
    kit.addProduct({ nameEn, searchText: nameEn.toLowerCase(), ...overrides });

  const move = (
    productId: string,
    qtyMilli: number,
    extra: Partial<typeof stockMovements.$inferInsert> = {},
  ) =>
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
        createdAt: new Date(Date.now() + 86_400_000 + tick++ * 1000),
        ...extra,
      })
      .returning()
      .get();

  const list = () => listNegativeStock(kit.database, kit.storeId);
  const names = () => list().map((item) => item.nameEn);

  it("leaves out products at zero, above zero and without movements", () => {
    const zero = product("Zero");
    move(zero.id, 1000);
    move(zero.id, -1000);
    product("Untouched");
    const plusOne = product("Plus one");
    move(plusOne.id, 1);
    const minusOne = product("Minus one");
    move(minusOne.id, -1);

    expect(list()).toEqual([expect.objectContaining({ nameEn: "Minus one", onHandMilli: -1 })]);
  });

  it("reports milli-unit totals", () => {
    const sugar = product("Sugar", { unit: "kg" });
    move(sugar.id, 1000);
    move(sugar.id, -1125);
    expect(list()[0]).toMatchObject({ unit: "kg", onHandMilli: -125 });
  });

  it("values weighed stock in integer paisa", () => {
    const sugar = product("Sugar", { unit: "kg", costPaisa: 14333 });
    const tea = product("Tea", { costPaisa: 105050 });
    move(sugar.id, -1250);
    move(tea.id, -3000);
    const byName = new Map(list().map((item) => [item.nameEn, item]));
    expect(byName.get("Sugar")?.stockValuePaisa).toBe(-17916);
    expect(byName.get("Tea")?.stockValuePaisa).toBe(-315150);
  });

  it("leaves out archived, deleted and system products and brings back restored ones", () => {
    const archived = product("Archived", { isActive: false });
    const deleted = product("Deleted", { deletedAt: new Date() });
    const system = product("System", { isSystem: true });
    const restored = product("Restored", { deletedAt: new Date() });
    for (const p of [archived, deleted, system, restored]) move(p.id, -1000);
    expect(names()).toEqual([]);

    kit.database.db
      .update(products)
      .set({ deletedAt: null })
      .where(eq(products.id, restored.id))
      .run();
    expect(names()).toEqual(["Restored"]);
  });

  it("returns the latest movement time even when that row was inserted first", () => {
    const tea = product("Tea");
    const latest = new Date("2031-05-06T07:08:09.000Z");
    move(tea.id, -1000, { createdAt: latest });
    move(tea.id, -500, { createdAt: new Date("2030-01-01T00:00:00.000Z") });
    expect(list()[0]?.lastMovementAt).toBe(latest.toISOString());
  });

  it("orders by name without regard to case", () => {
    for (const name of ["banana", "Apple", "cherry"]) move(product(name).id, -1000);
    expect(names()).toEqual(["Apple", "banana", "cherry"]);
  });

  it("returns every row without paging", () => {
    for (let i = 0; i < 130; i++) move(product(`Item ${String(i).padStart(3, "0")}`).id, -1000);
    expect(list()).toHaveLength(130);
  });
});
