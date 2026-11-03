import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createProductInputSchema,
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
import { createProductsService } from "./products";
import { normalizeSearchText } from "./search-text";

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

  const tables = () => ({
    products: database.db.select().from(products).all(),
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
      const row = database.db.select().from(products).get()!;
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
});
