import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createProductInputSchema,
  updateProductInputSchema,
  updateProductResultSchema,
  type CreateProductInput,
  type CreateProductResult,
} from "../../shared/products";
import { ForbiddenError, SessionLockedError } from "../auth/errors";
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
import { createProductsService } from "./products";
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

  const signIn = (role: "owner" | "manager" | "cashier") => {
    const user = database.db
      .insert(users)
      .values({
        username: `${role}-${Math.random().toString(36).slice(2, 8)}`,
        displayName: role,
        role,
        passwordHash: "x",
        pinHash: "x",
      })
      .returning()
      .get();
    sessions.start({
      userId: user.id,
      role,
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

  describe("permissions", () => {
    it("refuses a cashier and writes nothing", () => {
      signIn("cashier");
      expect(() => create()).toThrow(ForbiddenError);
      expect(tables()).toEqual({ products: [], barcodes: [], audit: [] });
    });

    it("refuses a locked session", () => {
      signIn("manager");
      sessions.lock();
      expect(() => create()).toThrow(SessionLockedError);
      expect(tables().products).toHaveLength(0);
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
    it("refuses a cashier and writes nothing", () => {
      signIn("manager");
      const product = created();
      signIn("cashier");
      expect(() => update(product.id, { salePricePaisa: 120000, mrpPaisa: null })).toThrow(
        ForbiddenError,
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
      (role) => {
        signIn(role);
        const misc = database.db.select().from(products).where(eq(products.isSystem, true)).get()!;
        const before = database.db.select().from(products).all();
        const auditBefore = database.db.select().from(auditLog).all();

        const result = update(misc.id, { nameEn: "Renamed", salePricePaisa: 500, mrpPaisa: null });

        expect(result).toEqual({
          ok: false,
          reason: "system-product",
          message: "Misc item is built in and can't be edited.",
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
});
