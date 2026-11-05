import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VendoraDatabase } from "./client";
import { desc, eq } from "drizzle-orm";
import {
  cashDenominations,
  categories,
  productBarcodes,
  products,
  stores,
  taxCategories,
  terminals,
} from "./schema";
import { seedStoreAndTerminal } from "./seed";
import { openMigratedDatabase } from "./test-database";

describe("seedStoreAndTerminal", () => {
  let dir: string;
  let database: VendoraDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-seed-"));
    database = openMigratedDatabase(join(dir, "vendora.db"));
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const denominationRows = () =>
    database.db.select().from(cashDenominations).orderBy(desc(cashDenominations.valuePaisa)).all();

  const systemProducts = () =>
    database.db.select().from(products).where(eq(products.isSystem, true)).all();

  it("creates one unnamed store with terminal T1", () => {
    seedStoreAndTerminal(database);

    const storeRows = database.db.select().from(stores).all();
    const terminalRows = database.db.select().from(terminals).all();
    expect(storeRows).toHaveLength(1);
    expect(storeRows[0]?.name).toBeNull();
    expect(terminalRows).toHaveLength(1);
    expect(terminalRows[0]?.code).toBe("T1");
    expect(terminalRows[0]?.storeId).toBe(storeRows[0]?.id);
  });

  it("is idempotent", () => {
    seedStoreAndTerminal(database);
    seedStoreAndTerminal(database);

    expect(database.db.select().from(stores).all()).toHaveLength(1);
    expect(database.db.select().from(terminals).all()).toHaveLength(1);
  });

  it("adds only a terminal when a store already exists", () => {
    const store = database.db.insert(stores).values({ name: "Existing" }).returning().get();

    seedStoreAndTerminal(database);

    expect(database.db.select().from(stores).all()).toHaveLength(1);
    const terminalRows = database.db.select().from(terminals).all();
    expect(terminalRows).toHaveLength(1);
    expect(terminalRows[0]?.storeId).toBe(store.id);
  });

  it("seeds General, Standard and Exempt once", () => {
    seedStoreAndTerminal(database);
    seedStoreAndTerminal(database);

    expect(
      database.db
        .select()
        .from(categories)
        .all()
        .map((c) => c.name),
    ).toEqual(["General"]);
    const tax = database.db.select().from(taxCategories).all();
    expect(tax.map((t) => [t.name, t.rateBps]).toSorted()).toEqual([
      ["Exempt", 0],
      ["Standard", null],
    ]);
  });

  it("does not re-create a soft-deleted default", () => {
    seedStoreAndTerminal(database);
    database.db
      .update(categories)
      .set({ deletedAt: new Date() })
      .where(eq(categories.name, "General"))
      .run();

    seedStoreAndTerminal(database);

    expect(database.db.select().from(categories).all()).toHaveLength(1);
  });

  it("does not add a default that exists with different case", () => {
    const store = database.db.insert(stores).values({}).returning().get();
    database.db.insert(categories).values({ storeId: store.id, name: "general" }).run();
    database.db
      .insert(taxCategories)
      .values({ storeId: store.id, name: "EXEMPT", rateBps: 0 })
      .run();

    seedStoreAndTerminal(database);

    expect(database.db.select().from(categories).all()).toHaveLength(1);
    expect(database.db.select().from(taxCategories).all()).toHaveLength(2);
  });

  describe("misc item", () => {
    it("seeds one system product with the General and Standard categories", () => {
      seedStoreAndTerminal(database);

      const store = database.db.select().from(stores).get();
      const general = database.db.select().from(categories).get();
      const standard = database.db
        .select()
        .from(taxCategories)
        .where(eq(taxCategories.name, "Standard"))
        .get();
      expect(systemProducts()).toEqual([
        expect.objectContaining({
          storeId: store?.id,
          nameEn: "Misc item",
          nameUr: null,
          unit: "piece",
          costPaisa: 0,
          salePricePaisa: 0,
          mrpPaisa: null,
          internalCode: null,
          brand: null,
          pctCode: null,
          lowStockThresholdMilli: null,
          isSystem: true,
          isActive: true,
          searchText: "misc item",
          categoryId: general?.id,
          taxCategoryId: standard?.id,
        }),
      ]);
      expect(database.db.select().from(productBarcodes).all()).toEqual([]);
    });

    it("seeds once across repeated runs", () => {
      seedStoreAndTerminal(database);
      seedStoreAndTerminal(database);

      expect(database.db.select().from(products).all()).toHaveLength(1);
    });

    it("does not add a second one after the product is soft-deleted", () => {
      seedStoreAndTerminal(database);
      database.db.update(products).set({ deletedAt: new Date() }).run();

      seedStoreAndTerminal(database);

      expect(systemProducts()).toHaveLength(1);
    });

    it("uses the system defaults after they were renamed", () => {
      seedStoreAndTerminal(database);
      database.db.delete(products).run();
      database.db.update(categories).set({ name: "Misc" }).run();
      database.db
        .update(taxCategories)
        .set({ name: "GST" })
        .where(eq(taxCategories.name, "Standard"))
        .run();

      seedStoreAndTerminal(database);

      const general = database.db.select().from(categories).get();
      const standard = database.db
        .select()
        .from(taxCategories)
        .where(eq(taxCategories.name, "GST"))
        .get();
      expect(systemProducts()).toEqual([
        expect.objectContaining({ categoryId: general?.id, taxCategoryId: standard?.id }),
      ]);
    });
  });

  it("flags the seeded defaults as system rows", () => {
    seedStoreAndTerminal(database);

    expect(
      database.db
        .select()
        .from(categories)
        .all()
        .map((c) => c.isSystem),
    ).toEqual([true]);
    expect(
      database.db
        .select()
        .from(taxCategories)
        .all()
        .map((t) => t.isSystem),
    ).toEqual([true, true]);
  });

  it("does not re-seed renamed defaults", () => {
    seedStoreAndTerminal(database);
    database.db
      .update(categories)
      .set({ name: "Misc" })
      .where(eq(categories.name, "General"))
      .run();
    database.db
      .update(taxCategories)
      .set({ name: "GST" })
      .where(eq(taxCategories.name, "Standard"))
      .run();

    seedStoreAndTerminal(database);

    expect(database.db.select().from(categories).all()).toHaveLength(1);
    expect(database.db.select().from(taxCategories).all()).toHaveLength(2);
  });

  it("adopts pre-existing defaults without duplicating them", () => {
    const store = database.db.insert(stores).values({}).returning().get();
    database.db.insert(categories).values({ storeId: store.id, name: "General" }).run();
    database.db
      .insert(taxCategories)
      .values([
        { storeId: store.id, name: "Standard", rateBps: null },
        { storeId: store.id, name: "Exempt", rateBps: 0 },
      ])
      .run();

    seedStoreAndTerminal(database);
    seedStoreAndTerminal(database);

    const cats = database.db.select().from(categories).all();
    const tax = database.db.select().from(taxCategories).all();
    expect(cats).toHaveLength(1);
    expect(tax).toHaveLength(2);
    expect([...cats, ...tax].every((row) => row.isSystem)).toBe(true);
  });

  describe("cash denominations", () => {
    it("seeds the ten notes and coins in paisa", () => {
      seedStoreAndTerminal(database);

      expect(denominationRows().map((row) => [row.valuePaisa, row.kind])).toEqual([
        [500000, "note"],
        [100000, "note"],
        [50000, "note"],
        [10000, "note"],
        [5000, "note"],
        [2000, "note"],
        [1000, "note"],
        [500, "coin"],
        [200, "coin"],
        [100, "coin"],
      ]);
    });

    it("leaves ten rows when seeding twice", () => {
      seedStoreAndTerminal(database);
      seedStoreAndTerminal(database);

      expect(denominationRows()).toHaveLength(10);
    });

    it("adds none after one is soft-deleted", () => {
      seedStoreAndTerminal(database);
      database.db
        .update(cashDenominations)
        .set({ deletedAt: new Date() })
        .where(eq(cashDenominations.valuePaisa, 100))
        .run();

      seedStoreAndTerminal(database);

      expect(denominationRows()).toHaveLength(10);
      expect(denominationRows().filter((row) => row.deletedAt === null)).toHaveLength(9);
    });
  });
});
