import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createProductInputSchema,
  productMessages,
  updateProductInputSchema,
  updateProductResultSchema,
  type CreateProductInput,
  type CreateProductResult,
} from "../../shared/products";
import { UnauthenticatedError } from "../auth/errors";
import { createSessionStore, type SessionStore } from "../auth/session";
import { openDatabase, type VendoraDatabase } from "../db/client";
import { runMigrations } from "../db/migrate";
import {
  auditLog,
  categories,
  productBarcodes,
  products,
  stores,
  taxCategories,
  users,
} from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { createAuditService } from "./audit";
import { searchProducts } from "./product-search";
import { createProductsService, getMiscItem } from "./products";
import { normalizeSearchText } from "./search-text";

const barcode = (code: string, packQtyMilli = 1000, salePricePaisa: number | null = null) => ({
  barcode: code,
  packQtyMilli,
  salePricePaisa,
});

describe("createProductsService", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let service: ReturnType<typeof createProductsService>;
  let categoryId: string;
  let taxCategoryId: string;

  const t0 = new Date("2026-01-01T10:00:00.000Z");

  const signIn = (name: string) => {
    const user = database.db
      .insert(users)
      .values({
        username: `${name}-${Math.random().toString(36).slice(2, 8)}`,
        displayName: name,
        passwordHash: "x",
        pinHash: "x",
      })
      .returning()
      .get();
    sessions.start({
      userId: user.id,
      storeId: database.db.select().from(stores).get()!.id,
      loggedInAt: t0,
    });
    return user;
  };

  const draft = (patch: Partial<CreateProductInput> = {}): CreateProductInput => ({
    nameEn: "Tapal Danedar 950g",
    nameUr: null,
    categoryId,
    taxCategoryId,
    brand: "Tapal",
    unit: "piece",
    internalCode: null,
    costPaisa: 90000,
    salePricePaisa: 105000,
    mrpPaisa: 110000,
    pctCode: null,
    lowStockThresholdMilli: 5000,
    barcodes: [],
    ...patch,
  });

  const create = (patch: Partial<CreateProductInput> = {}): CreateProductResult =>
    service.create(createProductInputSchema.parse(draft(patch)));

  const created = (patch: Partial<CreateProductInput> = {}) => {
    const result = create(patch);
    if (!result.ok) throw new Error(result.message);
    return result.product;
  };

  const update = (id: string, patch: Partial<CreateProductInput> = {}) =>
    service.update(updateProductInputSchema.parse({ ...draft(), id, ...patch }));

  const priceAudit = (action: "price_change" | "cost_change") =>
    database.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, action))
      .all()
      .map((row) => ({ ...row, details: JSON.parse(row.details ?? "null") }));

  const storeIdOf = () => database.db.select().from(stores).get()!.id;

  const tables = () => ({
    products: database.db.select().from(products).where(eq(products.isSystem, false)).all(),
    barcodes: database.db.select().from(productBarcodes).all(),
    audit: database.db.select().from(auditLog).all(),
  });

  const search = (includeArchived = false) =>
    searchProducts(database, database.db.select().from(stores).get()!.id, {
      query: "tapal",
      limit: 10,
      offset: 0,
      includeArchived,
    }).items.map((i) => i.id);

  const failingAudit = (failing: string) => {
    const real = createAuditService(database);
    return createProductsService({
      database,
      audit: {
        ...real,
        record: (input, tx) => {
          if (input.action === failing) throw new Error("audit down");
          return real.record(input, tx);
        },
      },
      sessions,
      now: () => t0,
    });
  };

  const productRow = (id: string) =>
    database.db.select().from(products).where(eq(products.id, id)).get()!;

  const auditRows = (action: string) =>
    database.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, action))
      .all()
      .map((row) => ({ ...row, details: JSON.parse(row.details ?? "null") }));

  const priced = (price: number, patch: Partial<CreateProductInput> = {}) =>
    created({
      nameEn: `Item ${Math.random().toString(36).slice(2, 8)}`,
      costPaisa: 100,
      salePricePaisa: price,
      mrpPaisa: null,
      ...patch,
    });

  const price = (id: string) => productRow(id).salePricePaisa;
  const makeCategory = (deleted = false) =>
    database.db
      .insert(categories)
      .values({
        storeId: database.db.select().from(stores).get()!.id,
        name: `Other ${Math.random().toString(36).slice(2, 8)}`,
        deletedAt: deleted ? t0 : null,
      })
      .returning()
      .get().id;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-products-"));
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, {
      migrationsFolder: join(process.cwd(), "drizzle"),
      backupDir: join(dir, "backups"),
    });
    seedStoreAndTerminal(database);
    categoryId = database.db.select().from(categories).get()!.id;
    taxCategoryId = database.db.select().from(taxCategories).get()!.id;
    sessions = createSessionStore();
    service = createProductsService({
      database,
      audit: createAuditService(database),
      sessions,
      now: () => t0,
    });
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("session", () => {
    it("refuses with no session and writes nothing", () => {
      expect(() => create()).toThrow(UnauthenticatedError);
      expect(tables()).toEqual({ products: [], barcodes: [], audit: [] });
    });
  });

  describe("reads", () => {
    it("gets an active product with cost and barcodes", () => {
      signIn("manager");
      const product = created({ barcodes: [barcode("B1"), barcode("B2")] });
      signIn("cashier");
      expect(service.get({ id: product.id })).toEqual({ ok: true, product });
      expect(product.costPaisa).toBe(90000);
      expect(product.barcodes.map((b) => b.barcode)).toEqual(["B1", "B2"]);
    });

    it("returns an archived product", () => {
      signIn("manager");
      const product = created();
      service.archive({ id: product.id });
      expect(service.get({ id: product.id })).toMatchObject({
        ok: true,
        product: { isActive: false },
      });
    });

    it("leaves out a removed barcode", () => {
      signIn("manager");
      const product = created({ barcodes: [barcode("B1"), barcode("B2")] });
      update(product.id, { barcodes: [barcode("B1")] });
      const result = service.get({ id: product.id });
      expect(result.ok && result.product.barcodes.map((b) => b.barcode)).toEqual(["B1"]);
    });

    it("refuses a deleted, system or unknown product", () => {
      signIn("manager");
      const deleted = created();
      service.delete({ id: deleted.id });
      const system = database.db
        .insert(products)
        .values({
          ...productRow(deleted.id),
          id: undefined,
          internalCode: null,
          isSystem: true,
          deletedAt: null,
          searchText: "system",
        })
        .returning()
        .get();
      for (const id of [deleted.id, system.id, "0192f3a0-0000-7000-8000-000000000099"]) {
        expect(service.get({ id })).toEqual({
          ok: false,
          reason: "not-found",
          message: productMessages.notFound,
        });
      }
    });

    it("lets a cashier search and look up a barcode in the session store", () => {
      signIn("manager");
      const product = created({ barcodes: [barcode("B1", 6000, 500000)] });
      signIn("cashier");
      expect(service.search({ query: "tapal", limit: 10, offset: 0 }).items).toHaveLength(1);
      expect(service.lookupBarcode({ barcode: "B1" })).toMatchObject({
        source: "barcode",
        product: { id: product.id, costPaisa: 90000 },
        packQtyMilli: 6000,
      });
    });

    it("refuses every read while signed out", () => {
      signIn("manager");
      const product = created();
      const reads = [
        () => service.search({ query: "", limit: 10, offset: 0 }),
        () => service.get({ id: product.id }),
        () => service.lookupBarcode({ barcode: "B1" }),
      ];
      sessions.end();
      for (const read of reads) expect(read).toThrow(UnauthenticatedError);
    });
  });

  describe("create", () => {
    it("lets a manager create a product with no barcodes", () => {
      signIn("manager");
      const product = created({ nameEn: "Lux Soap", nameUr: "لکس", internalCode: "LUX1" });

      expect(product.barcodes).toEqual([]);
      expect(product.isActive).toBe(true);
      const row = database.db.select().from(products).where(eq(products.isSystem, false)).get()!;
      expect(row.searchText).toBe(normalizeSearchText("Lux Soap", "لکس", "LUX1"));
      expect(row.storeId).toBe(database.db.select().from(stores).get()!.id);
      expect(tables().audit).toHaveLength(0);
    });

    it("lets an owner create a product with base and pack barcodes", () => {
      signIn("owner");
      const product = created({
        barcodes: [
          { barcode: "8961234567890", packQtyMilli: 1000, salePricePaisa: null },
          { barcode: "8961234567891", packQtyMilli: 24000, salePricePaisa: 2400000 },
          { barcode: "8961234567892", packQtyMilli: 12000, salePricePaisa: null },
        ],
      });

      expect(product.barcodes).toEqual([
        { barcode: "8961234567890", packQtyMilli: 1000, salePricePaisa: null },
        { barcode: "8961234567891", packQtyMilli: 24000, salePricePaisa: 2400000 },
        { barcode: "8961234567892", packQtyMilli: 12000, salePricePaisa: null },
      ]);
      expect(tables().barcodes).toHaveLength(3);
      expect(tables().audit).toHaveLength(0);
    });

    it("rejects MRP below the sale price at the schema and writes nothing", () => {
      signIn("manager");
      expect(createProductInputSchema.safeParse(draft({ mrpPaisa: 1 })).success).toBe(false);
      expect(tables().products).toHaveLength(0);
    });

    it("refuses a barcode that belongs to an active product", () => {
      signIn("manager");
      created({
        nameEn: "Tapal",
        barcodes: [{ barcode: "111", packQtyMilli: 1000, salePricePaisa: null }],
      });

      const result = create({
        nameEn: "Other",
        barcodes: [{ barcode: "111", packQtyMilli: 1000, salePricePaisa: null }],
      });

      expect(result).toMatchObject({ ok: false, reason: "barcode-taken" });
      expect(result.ok === false && result.message).toContain("Tapal");
      expect(tables().products).toHaveLength(1);
    });

    it("refuses a barcode that belongs to an archived product", () => {
      signIn("manager");
      const first = created({
        nameEn: "Archived Tea",
        barcodes: [{ barcode: "222", packQtyMilli: 1000, salePricePaisa: null }],
      });
      database.db.update(products).set({ isActive: false }).run();

      const result = create({
        nameEn: "Other",
        barcodes: [{ barcode: "222", packQtyMilli: 1000, salePricePaisa: null }],
      });

      expect(first.isActive).toBe(true);
      expect(result).toMatchObject({ ok: false, reason: "barcode-taken" });
      expect(result.ok === false && result.message).toContain("Archived Tea");
    });

    it("reuses a barcode whose only row is soft-deleted", () => {
      signIn("manager");
      created({ barcodes: [{ barcode: "333", packQtyMilli: 1000, salePricePaisa: null }] });
      database.db.update(productBarcodes).set({ deletedAt: t0 }).run();

      const result = create({
        nameEn: "Reuse",
        barcodes: [{ barcode: "333", packQtyMilli: 1000, salePricePaisa: null }],
      });

      expect(result.ok).toBe(true);
    });

    it("refuses a deleted category", () => {
      signIn("manager");
      database.db.update(categories).set({ deletedAt: t0 }).run();
      expect(create()).toMatchObject({ ok: false, reason: "category-not-found" });
      expect(tables().products).toHaveLength(0);
    });

    it("refuses a deleted tax category", () => {
      signIn("manager");
      database.db.update(taxCategories).set({ deletedAt: t0 }).run();
      expect(create()).toMatchObject({ ok: false, reason: "tax-category-not-found" });
      expect(tables().products).toHaveLength(0);
    });

    it("refuses a duplicate internal code", () => {
      signIn("manager");
      created({ nameEn: "First", internalCode: "A1" });
      const result = create({ nameEn: "Second", internalCode: "A1" });
      expect(result).toMatchObject({ ok: false, reason: "internal-code-taken" });
      expect(result.ok === false && result.message).toContain("First");
      expect(tables().products).toHaveLength(1);
    });
  });

  describe("update", () => {
    it("refuses with no session and writes nothing", () => {
      signIn("manager");
      const product = created();
      sessions.end();
      expect(() => update(product.id, { salePricePaisa: 120000, mrpPaisa: null })).toThrow(
        UnauthenticatedError,
      );
      expect(tables().audit).toHaveLength(0);
      expect(tables().products[0]!.salePricePaisa).toBe(105000);
    });

    it("writes one price_change for a sale price change", () => {
      const user = signIn("manager");
      const product = created();
      expect(update(product.id, { salePricePaisa: 108000 }).ok).toBe(true);

      const rows = priceAudit("price_change");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorUserId: user.id,
        entityType: "product",
        entityId: product.id,
        details: { oldPaisa: 105000, newPaisa: 108000 },
      });
      expect(priceAudit("cost_change")).toHaveLength(0);
    });

    it("writes one cost_change for a cost change", () => {
      signIn("owner");
      const product = created();
      update(product.id, { costPaisa: 95000 });

      expect(priceAudit("cost_change")).toHaveLength(1);
      expect(priceAudit("cost_change")[0]!.details).toEqual({ oldPaisa: 90000, newPaisa: 95000 });
      expect(priceAudit("price_change")).toHaveLength(0);
    });

    it("writes both rows when price and cost change", () => {
      signIn("manager");
      const product = created();
      update(product.id, { costPaisa: 95000, salePricePaisa: 108000 });
      expect(tables().audit).toHaveLength(2);
    });

    it("audits a pack barcode price changing to null", () => {
      signIn("manager");
      const product = created({ barcodes: [barcode("901", 24000, 3000)] });
      update(product.id, { barcodes: [barcode("901", 24000, null)] });

      const rows = priceAudit("price_change");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.details).toEqual({ barcode: "901", oldPaisa: 3000, newPaisa: null });
    });

    it("writes no audit for plain edits and rebuilds search_text", () => {
      signIn("manager");
      const product = created({ nameEn: "Old Name", internalCode: "OLD1" });
      const otherCategory = database.db
        .insert(categories)
        .values({ storeId: database.db.select().from(stores).get()!.id, name: "Drinks" })
        .returning()
        .get();

      const result = update(product.id, {
        nameEn: "Brand New",
        internalCode: "NEW1",
        brand: "Other",
        categoryId: otherCategory.id,
      });

      expect(result.ok).toBe(true);
      expect(tables().audit).toHaveLength(0);
      expect(tables().products[0]!.searchText).toBe(normalizeSearchText("Brand New", null, "NEW1"));
      const storeId = database.db.select().from(stores).get()!.id;
      const ids = (query: string) =>
        searchProducts(database, storeId, { query, limit: 10, offset: 0 }).items.map((i) => i.id);
      expect(ids("brand new")).toEqual([product.id]);
      expect(ids("new1")).toEqual([product.id]);
      expect(ids("old name")).toEqual([]);
    });

    it("replaces the barcode set", () => {
      signIn("manager");
      const product = created({ barcodes: [barcode("A1"), barcode("B2")] });
      const before = tables().barcodes;
      const keptId = before.find((b) => b.barcode === "A1")!.id;
      const removedId = before.find((b) => b.barcode === "B2")!.id;

      const result = update(product.id, { barcodes: [barcode("A1"), barcode("C3", 6000)] });

      expect(result.ok && result.product.barcodes.map((b) => b.barcode)).toEqual(["A1", "C3"]);
      const after = tables().barcodes;
      expect(after).toHaveLength(3);
      expect(after.find((b) => b.id === keptId)!.deletedAt).toBeNull();
      expect(after.find((b) => b.id === removedId)!.deletedAt).toEqual(t0);
      expect(after.find((b) => b.barcode === "C3")!.packQtyMilli).toBe(6000);
    });

    it("refuses a barcode owned by another product", () => {
      signIn("manager");
      created({ nameEn: "Owner Of 7", barcodes: [barcode("7")] });
      const mine = created({ nameEn: "Mine", barcodes: [barcode("8")] });

      const result = update(mine.id, { barcodes: [barcode("7")] });
      expect(result).toMatchObject({ ok: false, reason: "barcode-taken" });
      expect(result.ok === false && result.message).toContain("Owner Of 7");
    });

    it("allows keeping its own barcode and internal code", () => {
      signIn("manager");
      const product = created({ internalCode: "K1", barcodes: [barcode("9")] });
      expect(update(product.id, { internalCode: "K1", barcodes: [barcode("9")] }).ok).toBe(true);
    });

    it("refuses an internal code held by another product", () => {
      signIn("manager");
      created({ nameEn: "Holder", internalCode: "H1" });
      const mine = created({ nameEn: "Mine" });
      expect(update(mine.id, { internalCode: "H1" })).toMatchObject({
        ok: false,
        reason: "internal-code-taken",
      });
    });

    it("returns not-found for an unknown or deleted product", () => {
      signIn("manager");
      const product = created();
      expect(update("0192f3a0-0000-7000-8000-00000000ffff")).toMatchObject({
        ok: false,
        reason: "not-found",
      });
      database.db.update(products).set({ deletedAt: t0 }).where(eq(products.id, product.id)).run();
      expect(update(product.id)).toMatchObject({ ok: false, reason: "not-found" });
    });

    it.each(["owner", "manager"] as const)(
      "refuses %s editing the misc item and writes nothing",
      (name) => {
        signIn(name);
        const misc = database.db.select().from(products).where(eq(products.isSystem, true)).get()!;
        const before = database.db.select().from(products).all();
        const auditBefore = database.db.select().from(auditLog).all();

        const result = update(misc.id, { nameEn: "Renamed", salePricePaisa: 500, mrpPaisa: null });

        expect(result).toEqual({
          ok: false,
          reason: "system-product",
          message: productMessages.systemProduct,
        });
        expect(updateProductResultSchema.safeParse(result).success).toBe(true);
        expect(database.db.select().from(products).all()).toEqual(before);
        expect(database.db.select().from(productBarcodes).all()).toEqual([]);
        expect(database.db.select().from(auditLog).all()).toEqual(auditBefore);
      },
    );

    it("keeps the misc item out of search results", () => {
      expect(
        searchProducts(database, storeIdOf(), { query: "misc", limit: 10, offset: 0 }).items,
      ).toEqual([]);
    });

    it("rolls product, barcodes and audit back together when audit fails", () => {
      signIn("manager");
      const product = created({ barcodes: [barcode("R1"), barcode("R2")] });
      const real = createAuditService(database);
      const failing = createProductsService({
        database,
        audit: {
          ...real,
          record: (input, tx) => {
            if (input.action === "cost_change") throw new Error("audit down");
            return real.record(input, tx);
          },
        },
        sessions,
        now: () => t0,
      });
      const before = tables();

      expect(() =>
        failing.update(
          updateProductInputSchema.parse({
            ...draft({
              nameEn: "Changed",
              salePricePaisa: 120000,
              mrpPaisa: null,
              costPaisa: 99000,
              barcodes: [barcode("R1"), barcode("R3")],
            }),
            id: product.id,
          }),
        ),
      ).toThrow("audit down");

      expect(tables()).toEqual(before);
      expect(
        database.db
          .select()
          .from(productBarcodes)
          .where(and(eq(productBarcodes.barcode, "R3")))
          .all(),
      ).toHaveLength(0);
    });
  });

  describe("misc item lookup", () => {
    it("returns null while the setting is off and the product once it is on", () => {
      expect(getMiscItem(database, storeIdOf())).toBeNull();

      database.db.update(stores).set({ miscItemEnabled: true }).run();

      expect(getMiscItem(database, storeIdOf())).toMatchObject({
        nameEn: "Misc item",
        unit: "piece",
        salePricePaisa: 0,
        costPaisa: 0,
        barcodes: [],
      });
    });

    it("returns null when the setting is on but the product is gone", () => {
      database.db.update(stores).set({ miscItemEnabled: true }).run();
      database.db.update(products).set({ deletedAt: t0 }).run();

      expect(getMiscItem(database, storeIdOf())).toBeNull();
    });

    it("lets a cashier read it", () => {
      database.db.update(stores).set({ miscItemEnabled: true }).run();
      signIn("cashier");

      expect(service.miscItem()?.nameEn).toBe("Misc item");
    });

    it("requires a session", () => {
      expect(() => service.miscItem()).toThrow(UnauthenticatedError);
    });
  });

  describe("archive, restore and delete", () => {
    const t1 = new Date("2026-01-02T10:00:00.000Z");

    it.each(["archive", "restore"] as const)(
      "refuses %s with no session and writes nothing",
      (m) => {
        signIn("manager");
        const product = created();
        sessions.end();
        const before = tables();
        expect(() => service[m]({ id: product.id })).toThrow(UnauthenticatedError);
        expect(tables()).toEqual(before);
      },
    );

    it("lets an owner archive", () => {
      signIn("manager");
      const product = created();
      signIn("owner");
      expect(service.archive({ id: product.id }).ok).toBe(true);
    });

    it("toggles the flag and the default search follows", () => {
      signIn("manager");
      const product = created();

      const archived = service.archive({ id: product.id });
      expect(archived).toMatchObject({ ok: true, product: { isActive: false } });
      expect(productRow(product.id).isActive).toBe(false);
      expect(search()).toEqual([]);
      expect(search(true)).toEqual([product.id]);

      const restored = service.restore({ id: product.id });
      expect(restored).toMatchObject({ ok: true, product: { isActive: true } });
      expect(productRow(product.id).isActive).toBe(true);
      expect(search()).toEqual([product.id]);
    });

    it("is a no-op when already in the requested state", () => {
      signIn("manager");
      const product = created();
      let current = t0;
      const moving = createProductsService({
        database,
        audit: createAuditService(database),
        sessions,
        now: () => current,
      });

      expect(moving.restore({ id: product.id }).ok).toBe(true);
      expect(auditRows("product_restore")).toHaveLength(0);

      moving.archive({ id: product.id });
      const archivedAt = productRow(product.id).updatedAt;
      current = t1;
      expect(moving.archive({ id: product.id }).ok).toBe(true);
      expect(productRow(product.id).updatedAt).toEqual(archivedAt);
      expect(auditRows("product_archive")).toHaveLength(1);
    });

    it("protects a system product from archive", () => {
      signIn("manager");
      const base = created();
      const system = database.db
        .insert(products)
        .values({
          ...productRow(base.id),
          id: undefined,
          internalCode: null,
          isSystem: true,
          searchText: "system",
        })
        .returning()
        .get();
      const before = tables();
      expect(service.archive({ id: system.id })).toEqual({
        ok: false,
        reason: "system-product",
        message: productMessages.systemProduct,
      });
      expect(tables()).toEqual(before);
    });

    it("returns not-found for an unknown product", () => {
      signIn("manager");
      const id = "0190a3b4-7c5d-7e8f-9a0b-1c2d3e4f5a6b";
      expect(service.archive({ id })).toMatchObject({ ok: false, reason: "not-found" });
      expect(service.restore({ id })).toMatchObject({ ok: false, reason: "not-found" });
    });

    it("writes archive and restore audit rows with the actor", () => {
      const user = signIn("manager");
      const product = created();
      service.archive({ id: product.id });
      service.restore({ id: product.id });

      expect(auditRows("product_archive")).toEqual([
        expect.objectContaining({
          actorUserId: user.id,
          entityType: "product",
          entityId: product.id,
          details: { nameEn: "Tapal Danedar 950g" },
        }),
      ]);
      expect(auditRows("product_restore")).toEqual([
        expect.objectContaining({
          actorUserId: user.id,
          entityType: "product",
          entityId: product.id,
          details: { nameEn: "Tapal Danedar 950g" },
        }),
      ]);
    });

    it("rolls the archive back when audit fails", () => {
      signIn("manager");
      const product = created();
      expect(() => failingAudit("product_archive").archive({ id: product.id })).toThrow(
        "audit down",
      );
      expect(productRow(product.id).isActive).toBe(true);
    });

    it("refuses delete with no session and writes nothing", () => {
      signIn("manager");
      const product = created({ barcodes: [barcode("D0")] });
      sessions.end();
      const before = tables();
      expect(() => service.delete({ id: product.id })).toThrow(UnauthenticatedError);
      expect(tables()).toEqual(before);
    });

    it("soft-deletes the product, hides it and frees its barcodes and code", () => {
      signIn("manager");
      const product = created({ internalCode: "TD-1", barcodes: [barcode("D1"), barcode("D2")] });

      expect(service.delete({ id: product.id })).toEqual({ ok: true });

      expect(productRow(product.id).deletedAt).toEqual(t0);
      const rows = database.db.select().from(productBarcodes).all();
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.deletedAt !== null)).toBe(true);
      expect(search()).toEqual([]);
      expect(search(true)).toEqual([]);
      expect(update(product.id)).toMatchObject({ ok: false, reason: "not-found" });
      expect(service.archive({ id: product.id })).toMatchObject({ reason: "not-found" });
      expect(service.restore({ id: product.id })).toMatchObject({ reason: "not-found" });
      expect(service.delete({ id: product.id })).toMatchObject({ reason: "not-found" });

      const again = created({ internalCode: "TD-1", barcodes: [barcode("D1"), barcode("D2")] });
      expect(again.id).not.toBe(product.id);
    });

    it("deletes an archived product", () => {
      signIn("manager");
      const product = created();
      service.archive({ id: product.id });
      expect(service.delete({ id: product.id })).toEqual({ ok: true });
      expect(productRow(product.id)).toMatchObject({ isActive: false, deletedAt: t0 });
    });

    it("leaves already-deleted barcodes alone", () => {
      signIn("manager");
      const product = created({ barcodes: [barcode("K1"), barcode("K2")] });
      const earlier = new Date("2026-01-01T12:00:00.000Z");
      createProductsService({
        database,
        audit: createAuditService(database),
        sessions,
        now: () => earlier,
      }).update(
        updateProductInputSchema.parse({
          ...draft({ barcodes: [barcode("K2")] }),
          id: product.id,
        }),
      );

      service.delete({ id: product.id });

      const byCode = new Map(
        database.db
          .select()
          .from(productBarcodes)
          .all()
          .map((r) => [r.barcode, r.deletedAt]),
      );
      expect(byCode.get("K1")).toEqual(earlier);
      expect(byCode.get("K2")).toEqual(t0);
    });

    it("protects a system product from delete", () => {
      signIn("manager");
      const base = created();
      const system = database.db
        .insert(products)
        .values({
          ...productRow(base.id),
          id: undefined,
          internalCode: null,
          isSystem: true,
          searchText: "system",
        })
        .returning()
        .get();
      const before = tables();
      expect(service.delete({ id: system.id })).toEqual({
        ok: false,
        reason: "system-product",
        message: productMessages.systemProduct,
      });
      expect(tables()).toEqual(before);
    });

    it("returns not-found for an unknown product on delete", () => {
      signIn("manager");
      expect(service.delete({ id: "0190a3b4-7c5d-7e8f-9a0b-1c2d3e4f5a6b" })).toMatchObject({
        ok: false,
        reason: "not-found",
      });
    });

    it("writes a delete audit row with the freed barcodes sorted", () => {
      const user = signIn("manager");
      const product = created({ barcodes: [barcode("B2"), barcode("A1")] });
      service.delete({ id: product.id });

      expect(auditRows("product_delete")).toEqual([
        expect.objectContaining({
          actorUserId: user.id,
          entityType: "product",
          entityId: product.id,
          details: { nameEn: "Tapal Danedar 950g", barcodes: ["A1", "B2"] },
        }),
      ]);
    });

    it("rolls the delete back when audit fails", () => {
      signIn("manager");
      const product = created({ barcodes: [barcode("F1")] });
      const before = tables();
      expect(() => failingAudit("product_delete").delete({ id: product.id })).toThrow("audit down");
      expect(tables()).toEqual(before);
      expect(productRow(product.id).deletedAt).toBeNull();
    });
  });

  describe("bulkUpdate", () => {
    const later = new Date("2026-02-01T10:00:00.000Z");
    const unknownId = "0192f3a0-0000-7000-8000-0000000000ff";

    const laterService = () =>
      createProductsService({
        database,
        audit: createAuditService(database),
        sessions,
        now: () => later,
      });

    it("sets a category on changed products only", () => {
      signIn("manager");
      const target = makeCategory();
      const a = priced(1000);
      const b = priced(2000, { categoryId: target });
      const result = laterService().bulkUpdate({
        productIds: [a.id, b.id],
        change: { kind: "category", categoryId: target },
      });
      expect(result).toEqual({ ok: true, changed: 1, unchanged: 1 });
      expect(productRow(a.id).categoryId).toBe(target);
      expect(productRow(a.id).updatedAt).toEqual(later);
      expect(productRow(b.id).updatedAt).toEqual(t0);
      expect(tables().audit).toHaveLength(0);
    });

    it("refuses a deleted or unknown category and writes nothing", () => {
      signIn("manager");
      const a = priced(1000);
      const before = tables();
      for (const target of [makeCategory(true), unknownId]) {
        expect(
          service.bulkUpdate({
            productIds: [a.id],
            change: { kind: "category", categoryId: target },
          }),
        ).toMatchObject({ ok: false, reason: "category-not-found" });
      }
      expect(tables().products).toEqual(before.products);
    });

    it("sets a price and audits each changed product", () => {
      const user = signIn("manager");
      const a = priced(1000);
      const b = priced(5000);
      const result = service.bulkUpdate({
        productIds: [a.id, b.id],
        change: { kind: "set-price", salePricePaisa: 5000 },
      });
      expect(result).toEqual({ ok: true, changed: 1, unchanged: 1 });
      expect(price(a.id)).toBe(5000);
      expect(auditRows("price_change")).toEqual([
        expect.objectContaining({
          actorUserId: user.id,
          entityType: "product",
          entityId: a.id,
          details: { oldPaisa: 1000, newPaisa: 5000, bulk: true },
        }),
      ]);
    });

    it("adjusts by percentage with rounding and skips products that round to their price", () => {
      signIn("manager");
      const a = priced(16050);
      const b = priced(125000);
      const c = priced(10000);
      const result = laterService().bulkUpdate({
        productIds: [a.id, b.id, c.id],
        change: { kind: "adjust-price", bps: 1000 },
      });
      expect(result).toEqual({ ok: true, changed: 3, unchanged: 0 });
      expect([price(a.id), price(b.id), price(c.id)]).toEqual([17700, 137500, 11000]);

      const near = priced(10000);
      const same = laterService().bulkUpdate({
        productIds: [near.id],
        change: { kind: "adjust-price", bps: 10 },
      });
      expect(same).toEqual({ ok: true, changed: 0, unchanged: 1 });
      expect(price(near.id)).toBe(10000);
      expect(productRow(near.id).updatedAt).toEqual(t0);
      expect(auditRows("price_change")).toHaveLength(3);
    });

    it("aborts the whole batch when one price exceeds MRP", () => {
      signIn("manager");
      const a = priced(1000);
      const b = priced(125000, { mrpPaisa: 130000 });
      const c = priced(2000);
      const before = tables();
      const result = service.bulkUpdate({
        productIds: [a.id, b.id, c.id],
        change: { kind: "adjust-price", bps: 1000 },
      });
      expect(result).toEqual({
        ok: false,
        reason: "above-mrp",
        message: productMessages.aboveMrp(1),
        products: [{ id: b.id, nameEn: b.nameEn, salePricePaisa: 137500, mrpPaisa: 130000 }],
      });
      expect(tables()).toEqual(before);
    });

    it("never caps products without an MRP", () => {
      signIn("manager");
      const a = priced(1000);
      expect(
        service.bulkUpdate({
          productIds: [a.id],
          change: { kind: "set-price", salePricePaisa: 99999999 },
        }),
      ).toEqual({ ok: true, changed: 1, unchanged: 0 });
    });

    it("rejects the whole call for unknown, deleted and system products", () => {
      signIn("manager");
      const ok = priced(1000);
      const gone = priced(1000);
      service.delete({ id: gone.id });
      const system = created();
      database.db.update(products).set({ isSystem: true }).where(eq(products.id, system.id)).run();
      const before = tables();

      const result = service.bulkUpdate({
        productIds: [ok.id, unknownId, gone.id, system.id],
        change: { kind: "set-price", salePricePaisa: 5 },
      });
      expect(result).toEqual({
        ok: false,
        reason: "ineligible-products",
        message: productMessages.ineligibleProducts,
        productIds: [unknownId, gone.id, system.id],
      });
      expect(tables()).toEqual(before);
    });

    it("treats products from another store as ineligible", () => {
      signIn("manager");
      const a = priced(1000);
      const otherStore = database.db.insert(stores).values({ name: "Other" }).returning().get();
      database.db
        .update(products)
        .set({ storeId: otherStore.id })
        .where(eq(products.id, a.id))
        .run();
      expect(
        service.bulkUpdate({
          productIds: [a.id],
          change: { kind: "set-price", salePricePaisa: 5 },
        }),
      ).toMatchObject({ ok: false, reason: "ineligible-products", productIds: [a.id] });
    });

    it("updates archived products", () => {
      signIn("manager");
      const a = priced(1000);
      service.archive({ id: a.id });
      expect(
        service.bulkUpdate({
          productIds: [a.id],
          change: { kind: "set-price", salePricePaisa: 2000 },
        }),
      ).toEqual({ ok: true, changed: 1, unchanged: 0 });
      expect(productRow(a.id)).toMatchObject({ salePricePaisa: 2000, isActive: false });
    });

    it("leaves pack barcode prices alone", () => {
      signIn("manager");
      const a = priced(1000, { barcodes: [barcode("P1", 12000, 11000)] });
      service.bulkUpdate({ productIds: [a.id], change: { kind: "adjust-price", bps: 5000 } });
      expect(price(a.id)).toBe(1500);
      expect(tables().barcodes.map((b) => b.salePricePaisa)).toEqual([11000]);
    });

    it("allows every signed-in user, refuses with no session", () => {
      const change = { kind: "set-price", salePricePaisa: 1 } as const;
      signIn("manager");
      const a = priced(1000);
      expect(service.bulkUpdate({ productIds: [a.id], change })).toMatchObject({ ok: true });

      sessions.end();
      signIn("owner");
      expect(service.bulkUpdate({ productIds: [a.id], change })).toMatchObject({ ok: true });

      sessions.end();
      signIn("cashier");
      expect(service.bulkUpdate({ productIds: [a.id], change })).toMatchObject({ ok: true });

      sessions.end();
      expect(() => service.bulkUpdate({ productIds: [a.id], change })).toThrow(
        UnauthenticatedError,
      );
    });

    it("rolls every product back when an audit write fails midway", () => {
      signIn("manager");
      const items = [priced(1000), priced(2000), priced(3000)];
      const real = createAuditService(database);
      let calls = 0;
      const flaky = createProductsService({
        database,
        audit: {
          ...real,
          record: (input, tx) => {
            calls += 1;
            if (calls === 2) throw new Error("audit down");
            return real.record(input, tx);
          },
        },
        sessions,
        now: () => t0,
      });
      expect(() =>
        flaky.bulkUpdate({
          productIds: items.map((p) => p.id),
          change: { kind: "set-price", salePricePaisa: 7 },
        }),
      ).toThrow("audit down");
      expect(items.map((p) => price(p.id))).toEqual([1000, 2000, 3000]);
      expect(tables().audit).toHaveLength(0);
    });

    it("handles 5,000 products in one call", () => {
      signIn("manager");
      const storeId = database.db.select().from(stores).get()!.id;
      const rows = Array.from({ length: 5000 }, (_, i) => ({
        storeId,
        nameEn: `Bulk ${i}`,
        searchText: `bulk ${i}`,
        categoryId,
        taxCategoryId,
        unit: "piece" as const,
        costPaisa: 10,
        salePricePaisa: 1000,
        createdAt: t0,
        updatedAt: t0,
      }));
      const ids: string[] = [];
      for (let i = 0; i < rows.length; i += 500) {
        ids.push(
          ...database.db
            .insert(products)
            .values(rows.slice(i, i + 500))
            .returning({ id: products.id })
            .all()
            .map((r) => r.id),
        );
      }
      expect(
        service.bulkUpdate({ productIds: ids, change: { kind: "adjust-price", bps: 1000 } }),
      ).toEqual({ ok: true, changed: 5000, unchanged: 0 });
      expect(auditRows("price_change")).toHaveLength(5000);
    });
  });
});
