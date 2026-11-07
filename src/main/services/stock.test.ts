import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { uuidv7 } from "../db/id";
import {
  auditLog,
  categories,
  products,
  stockMovements,
  stores,
  taxCategories,
  terminals,
  users,
  stockMovementReasons,
  type ProductUnit,
  type StockMovementReason,
} from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { createAuditService } from "./audit";
import { createProductsService } from "./products";
import * as stockModule from "./stock";
import { movementReasons } from "../../shared/inventory";
import { createStockService, movementTypeForReason, type RecordMovementInput } from "./stock";
import { openMigratedDatabase } from "../db/test-database";

describe("createStockService", () => {
  let dir: string;
  let database: VendoraDatabase;
  let service: ReturnType<typeof createStockService>;
  let storeId: string;
  let terminalId: string;
  let categoryId: string;
  let taxCategoryId: string;
  let actorId: string;
  let productId: string;
  let clock: Date;

  const t0 = new Date("2026-01-01T10:00:00.000Z");

  const addProduct = (overrides: Partial<typeof products.$inferInsert> = {}) =>
    database.db
      .insert(products)
      .values({
        storeId,
        nameEn: "Tea",
        searchText: "tea",
        categoryId,
        taxCategoryId,
        unit: "piece" as ProductUnit,
        costPaisa: 10000,
        salePricePaisa: 12000,
        ...overrides,
      })
      .returning()
      .get();

  const record = (
    input: Omit<RecordMovementInput, "productId" | "actorUserId"> & Partial<RecordMovementInput>,
  ) =>
    database.db.transaction((tx) =>
      service.record(tx, { productId, actorUserId: actorId, ...input }),
    );

  const refused = (input: Record<string, unknown>) => {
    expect(() => record(input as never)).toThrow();
    expect(movementRows()).toEqual([]);
  };

  const setOnHand = (
    onHandMilli: number,
    id = productId,
    reason: StockMovementReason = "correction",
  ) =>
    database.db.transaction((tx) =>
      service.setOnHand(tx, { productId: id, onHandMilli, reason, actorUserId: actorId }),
    );

  const costOf = (id = productId) =>
    database.db.select().from(products).where(eq(products.id, id)).get()!.costPaisa;
  const movementRows = () => database.db.select().from(stockMovements).all();
  const auditRows = () =>
    database.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "stock_adjustment"))
      .all()
      .map((row) => ({ ...row, details: JSON.parse(row.details ?? "null") }));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-stock-"));
    database = openMigratedDatabase(join(dir, "vendora.db"));
    seedStoreAndTerminal(database);
    storeId = database.db.select().from(stores).get()!.id;
    terminalId = database.db.select().from(terminals).get()!.id;
    categoryId = database.db.select().from(categories).get()!.id;
    taxCategoryId = database.db.select().from(taxCategories).get()!.id;
    actorId = database.db
      .insert(users)
      .values({ username: "owner", displayName: "Owner", passwordHash: "x", pinHash: "x" })
      .returning()
      .get().id;
    productId = addProduct().id;
    clock = t0;
    service = createStockService({
      database,
      audit: createAuditService(database),
      now: () => clock,
    });
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("on-hand", () => {
    it("equals the sum of movements", () => {
      record({ type: "receipt", qtyMilli: 10000, unitCostPaisa: 10000 });
      record({ type: "sale", qtyMilli: -3000 });
      record({ type: "return", qtyMilli: 1000 });
      record({ type: "damage", qtyMilli: -500, reason: "damage" });
      record({ type: "stocktake", qtyMilli: -250 });

      expect(service.onHand(productId)).toBe(7250);
      const raw = database.sqlite
        .prepare("SELECT SUM(qty_milli) AS total FROM stock_movements WHERE product_id = ?")
        .get(productId) as { total: number };
      expect(raw.total).toBe(7250);
    });

    it("is zero for a product with no movements", () => {
      expect(service.onHand(productId)).toBe(0);
    });

    it("allows negative stock", () => {
      record({ type: "sale", qtyMilli: -5000 });
      expect(service.onHand(productId)).toBe(-5000);
    });

    it("stamps the store and terminal", () => {
      record({ type: "sale", qtyMilli: -1000 });
      expect(movementRows()[0]).toMatchObject({ storeId, terminalId, actorUserId: actorId });
    });

    it("accepts movements for archived and soft-deleted products", () => {
      const archived = addProduct({ isActive: false });
      const deleted = addProduct({ deletedAt: t0 });
      for (const id of [archived.id, deleted.id]) {
        record({ productId: id, type: "return", qtyMilli: 1000 });
        expect(service.onHand(id)).toBe(1000);
      }
    });
  });

  describe("average cost", () => {
    it("takes the incoming cost when nothing is on hand", () => {
      record({ type: "receipt", qtyMilli: 10000, unitCostPaisa: 12000 });
      expect(costOf()).toBe(12000);
    });

    it("averages with stock on hand and rounds half up", () => {
      record({ type: "receipt", qtyMilli: 10000, unitCostPaisa: 12000 });
      record({ type: "receipt", qtyMilli: 10000, unitCostPaisa: 13001 });
      expect(costOf()).toBe(12501);
    });

    it("takes the incoming cost when on-hand is negative", () => {
      record({ type: "sale", qtyMilli: -4000 });
      record({ type: "receipt", qtyMilli: 10000, unitCostPaisa: 13000 });
      expect(costOf()).toBe(13000);
    });

    it("leaves the cost unchanged for positive return, adjustment and stocktake", () => {
      record({ type: "receipt", qtyMilli: 10000, unitCostPaisa: 12000 });
      record({ type: "return", qtyMilli: 1000 });
      record({ type: "adjustment", qtyMilli: 1000, reason: "correction" });
      record({ type: "stocktake", qtyMilli: 1000 });
      expect(costOf()).toBe(12000);
    });

    it("averages from a manually edited cost", () => {
      const sessions = createSessionStore();
      sessions.start({ userId: actorId, storeId, loggedInAt: t0 });
      const productsService = createProductsService({
        database,
        audit: createAuditService(database),
        sessions,
        now: () => t0,
      });
      const created = productsService.create({
        nameEn: "Sugar",
        nameUr: null,
        categoryId,
        taxCategoryId,
        brand: null,
        unit: "piece",
        internalCode: null,
        costPaisa: 10000,
        salePricePaisa: 12000,
        mrpPaisa: null,
        pctCode: null,
        lowStockThresholdMilli: null,
        barcodes: [],
      });
      if (!created.ok) throw new Error(created.message);
      const id = created.product.id;
      record({ productId: id, type: "receipt", qtyMilli: 10000, unitCostPaisa: 10000 });

      const updated = productsService.update({
        id,
        nameEn: "Sugar",
        nameUr: null,
        categoryId,
        taxCategoryId,
        brand: null,
        unit: "piece",
        internalCode: null,
        costPaisa: 20000,
        salePricePaisa: 25000,
        mrpPaisa: null,
        pctCode: null,
        lowStockThresholdMilli: null,
        barcodes: [],
      });
      expect(updated.ok).toBe(true);
      expect(
        database.db.select().from(auditLog).where(eq(auditLog.action, "cost_change")).all(),
      ).toHaveLength(1);

      record({ productId: id, type: "receipt", qtyMilli: 10000, unitCostPaisa: 30000 });
      expect(costOf(id)).toBe(25000);
    });

    it("audits a receipt that moves the cost, with the actor", () => {
      record({ type: "receipt", qtyMilli: 10000, unitCostPaisa: 12000 });

      const rows = database.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "cost_change"))
        .all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorUserId: actorId,
        entityType: "product",
        entityId: productId,
      });
      expect(JSON.parse(rows[0]!.details ?? "null")).toEqual({ oldPaisa: 10000, newPaisa: 12000 });
    });

    it("writes no cost_change when a receipt leaves the cost unchanged", () => {
      record({ type: "receipt", qtyMilli: 10000, unitCostPaisa: 10000 });

      expect(
        database.db.select().from(auditLog).where(eq(auditLog.action, "cost_change")).all(),
      ).toEqual([]);
    });

    it("removes the cost_change row when the caller's transaction rolls back", () => {
      expect(() =>
        database.db.transaction((tx) => {
          service.record(tx, {
            productId,
            actorUserId: actorId,
            type: "receipt",
            qtyMilli: 10000,
            unitCostPaisa: 12000,
          });
          throw new Error("later step failed");
        }),
      ).toThrow("later step failed");

      expect(
        database.db.select().from(auditLog).where(eq(auditLog.action, "cost_change")).all(),
      ).toEqual([]);
      expect(costOf()).toBe(10000);
    });

    it("snapshots the current cost on non-receipt movements", () => {
      record({ type: "sale", qtyMilli: -1000 });
      record({ type: "receipt", qtyMilli: 10000, unitCostPaisa: 12000 });
      record({ type: "sale", qtyMilli: -1000 });

      const sales = movementRows().filter((m) => m.type === "sale");
      expect(sales.map((m) => m.unitCostPaisa)).toEqual([10000, 12000]);
    });
  });

  describe("audit", () => {
    it("audits an adjustment", () => {
      record({ type: "receipt", qtyMilli: 5000, unitCostPaisa: 10000 });
      const movement = record({ type: "adjustment", qtyMilli: -2000, reason: "correction" });

      const rows = auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorUserId: actorId,
        entityType: "product",
        entityId: productId,
        details: {
          movementId: movement.id,
          type: "adjustment",
          qtyMilli: -2000,
          reason: "correction",
          onHandBeforeMilli: 5000,
          onHandAfterMilli: 3000,
        },
      });
    });

    it("audits a damage movement without a source", () => {
      const movement = record({ type: "damage", qtyMilli: -100, reason: "expiry" });
      const rows = auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        details: { movementId: movement.id, type: "damage", qtyMilli: -100, reason: "expiry" },
      });
    });

    it("does not audit sale, receipt or sourced damage", () => {
      record({ type: "sale", qtyMilli: -1000 });
      record({ type: "receipt", qtyMilli: 1000, unitCostPaisa: 100 });
      record({
        type: "damage",
        qtyMilli: -100,
        reason: "damage",
        sourceType: "sale_line",
        sourceId: "l1",
      });
      expect(auditRows()).toEqual([]);
    });
  });

  describe("validation", () => {
    it("refuses opening", () => refused({ type: "opening", qtyMilli: 1000 }));
    it("refuses zero quantity", () => refused({ type: "stocktake", qtyMilli: 0 }));
    it("refuses a positive sale", () => refused({ type: "sale", qtyMilli: 1000 }));
    it("refuses a positive damage", () =>
      refused({ type: "damage", qtyMilli: 1000, reason: "damage" }));
    it("refuses a negative return", () => refused({ type: "return", qtyMilli: -1000 }));
    it("refuses a negative receipt", () =>
      refused({ type: "receipt", qtyMilli: -1000, unitCostPaisa: 100 }));
    it("refuses a fractional quantity", () => refused({ type: "sale", qtyMilli: -1.5 }));
    it("refuses an adjustment without a reason", () =>
      refused({ type: "adjustment", qtyMilli: -1000 }));
    it("refuses damage without a reason", () => refused({ type: "damage", qtyMilli: -1000 }));
    it("refuses an unknown reason", () =>
      refused({ type: "adjustment", qtyMilli: -1000, reason: "lost" }));
    it("refuses theft, expiry and damage on an adjustment", () => {
      for (const reason of ["theft", "expiry", "damage"]) {
        refused({ type: "adjustment", qtyMilli: -1000, reason });
      }
    });
    it("refuses correction on damage", () =>
      refused({ type: "damage", qtyMilli: -1000, reason: "correction" }));
    it("accepts expiry and theft on damage", () => {
      expect(record({ type: "damage", qtyMilli: -1000, reason: "expiry" }).type).toBe("damage");
      expect(record({ type: "damage", qtyMilli: -1000, reason: "theft" }).type).toBe("damage");
    });
    it("maps each reason to a movement type", () => {
      expect(movementTypeForReason("correction")).toBe("adjustment");
      for (const reason of ["damage", "expiry", "theft"] as const) {
        expect(movementTypeForReason(reason)).toBe("damage");
      }
    });
    it("keeps the shared reasons in step with the schema", () => {
      expect([...movementReasons]).toEqual([...stockMovementReasons]);
    });
    it("refuses a reason on a sale", () =>
      refused({ type: "sale", qtyMilli: -1000, reason: "damage" }));
    it("refuses a receipt without a unit cost", () => refused({ type: "receipt", qtyMilli: 1000 }));
    it("refuses a negative unit cost", () =>
      refused({ type: "receipt", qtyMilli: 1000, unitCostPaisa: -1 }));
    it("refuses a unit cost on a sale", () =>
      refused({ type: "sale", qtyMilli: -1000, unitCostPaisa: 100 }));
    it("refuses a source type without an id", () =>
      refused({ type: "sale", qtyMilli: -1000, sourceType: "sale_line" }));
    it("refuses a source id without a type", () =>
      refused({ type: "sale", qtyMilli: -1000, sourceId: "l1" }));
    it("refuses unknown keys", () => refused({ type: "sale", qtyMilli: -1000, extra: 1 }));

    it("stores a paired source", () => {
      const movement = record({
        type: "sale",
        qtyMilli: -1000,
        sourceType: "sale_line",
        sourceId: "l1",
      });
      expect(movement).toMatchObject({ sourceType: "sale_line", sourceId: "l1" });
    });

    it("throws for an unknown product", () => {
      expect(() => record({ productId: uuidv7(), type: "sale", qtyMilli: -1000 })).toThrow(
        "Product not found",
      );
      expect(movementRows()).toEqual([]);
    });

    it("throws for a product in another store", () => {
      const other = database.db.insert(stores).values({}).returning().get().id;
      const category = database.db
        .insert(categories)
        .values({ storeId: other, name: "Other" })
        .returning()
        .get().id;
      const tax = database.db
        .insert(taxCategories)
        .values({ storeId: other, name: "Other" })
        .returning()
        .get().id;
      const foreign = addProduct({ storeId: other, categoryId: category, taxCategoryId: tax });
      expect(() => record({ productId: foreign.id, type: "sale", qtyMilli: -1000 })).toThrow(
        "Product not found",
      );
    });
  });

  describe("transactions", () => {
    it("rolls back with the caller's transaction", () => {
      expect(() =>
        database.db.transaction((tx) => {
          service.record(tx, {
            productId,
            actorUserId: actorId,
            type: "receipt",
            qtyMilli: 10000,
            unitCostPaisa: 20000,
          });
          service.record(tx, {
            productId,
            actorUserId: actorId,
            type: "adjustment",
            qtyMilli: -1000,
            reason: "correction",
          });
          throw new Error("checkout failed");
        }),
      ).toThrow("checkout failed");

      expect(movementRows()).toEqual([]);
      expect(auditRows()).toEqual([]);
      expect(costOf()).toBe(10000);
    });

    it("keeps both rows on commit", () => {
      database.db.transaction((tx) => {
        service.record(tx, {
          productId,
          actorUserId: actorId,
          type: "receipt",
          qtyMilli: 10000,
          unitCostPaisa: 20000,
        });
        service.record(tx, {
          productId,
          actorUserId: actorId,
          type: "adjustment",
          qtyMilli: -1000,
          reason: "correction",
        });
      });
      expect(movementRows()).toHaveLength(2);
      expect(auditRows()).toHaveLength(1);
    });
  });

  describe("setOnHand", () => {
    it("records a reasoned adjustment for a product with no movements", () => {
      const result = setOnHand(12000);
      expect(result.onHandMilli).toBe(12000);
      expect(result.movement).toMatchObject({
        type: "adjustment",
        qtyMilli: 12000,
        reason: "correction",
      });
      expect(costOf()).toBe(10000);
      expect(service.onHand(productId)).toBe(12000);
      expect(auditRows()).toHaveLength(1);
      expect(auditRows()[0]).toMatchObject({
        actorUserId: actorId,
        details: { type: "adjustment", onHandBeforeMilli: 0, onHandAfterMilli: 12000 },
      });
    });

    it("records a negative count by reason", () => {
      expect(setOnHand(-2000).movement).toMatchObject({ type: "adjustment", qtyMilli: -2000 });
      expect(setOnHand(-4000, productId, "theft").movement).toMatchObject({
        type: "damage",
        qtyMilli: -2000,
        reason: "theft",
      });
      expect(service.onHand(productId)).toBe(-4000);
    });

    it("saves expiry as a damage movement", () => {
      record({ type: "return", qtyMilli: 3000 });
      expect(setOnHand(1000, productId, "expiry").movement).toMatchObject({
        type: "damage",
        qtyMilli: -2000,
        reason: "expiry",
      });
    });

    it("refuses damage when the target is higher", () => {
      expect(() => setOnHand(1000, productId, "damage")).toThrow();
      expect(movementRows()).toEqual([]);
      expect(auditRows()).toEqual([]);
    });

    it("refuses a missing or unknown reason", () => {
      const input = { productId, onHandMilli: 1000, actorUserId: actorId };
      expect(() =>
        database.db.transaction((tx) => service.setOnHand(tx, input as never)),
      ).toThrow();
      expect(() => setOnHand(1000, productId, "lost" as never)).toThrow();
      expect(movementRows()).toEqual([]);
    });

    it("records a correction adjustment on a product with movements", () => {
      record({ type: "receipt", qtyMilli: 10000, unitCostPaisa: 10000 });
      record({ type: "sale", qtyMilli: -3000 });
      record({ type: "return", qtyMilli: 1000 });
      record({
        type: "damage",
        qtyMilli: -500,
        reason: "damage",
        sourceType: "sale_line",
        sourceId: "l1",
      });
      record({ type: "stocktake", qtyMilli: -250 });

      const result = setOnHand(5000);
      expect(result.movement).toMatchObject({
        type: "adjustment",
        qtyMilli: -2250,
        reason: "correction",
      });
      expect(service.onHand(productId)).toBe(5000);
      expect(auditRows()).toHaveLength(1);
      expect(auditRows()[0]).toMatchObject({
        actorUserId: actorId,
        details: { onHandBeforeMilli: 7250, onHandAfterMilli: 5000 },
      });
    });

    it("writes nothing when the target equals on-hand", () => {
      record({ type: "return", qtyMilli: 1000 });
      expect(setOnHand(1000, productId, "theft")).toEqual({ movement: null, onHandMilli: 1000 });
      expect(movementRows()).toHaveLength(1);
      expect(auditRows()).toEqual([]);
      expect(setOnHand(0, addProduct().id)).toMatchObject({ movement: null });
    });

    it("refuses a fractional target and an unknown product", () => {
      expect(() => setOnHand(1.5)).toThrow();
      expect(() => setOnHand(1000, uuidv7())).toThrow("Product not found");
      expect(movementRows()).toEqual([]);
    });
  });

  describe("append-only", () => {
    it("exposes no update or delete path", () => {
      expect(Object.keys(service)).toEqual([
        "record",
        "recordStocktakeMovements",
        "setOnHand",
        "onHand",
        "onHandMany",
        "history",
      ]);
      for (const name of Object.keys(stockModule)) {
        expect(name).not.toMatch(/update|delete|remove/i);
      }
    });
  });

  describe("onHandMany", () => {
    it("returns every requested id, deduplicated", () => {
      const empty = addProduct().id;
      record({ type: "receipt", qtyMilli: 4000, unitCostPaisa: 100 });

      const result = service.onHandMany([productId, empty, productId]);
      expect(result).toEqual(
        new Map([
          [productId, 4000],
          [empty, 0],
        ]),
      );
    });

    it("returns an empty map for an empty list", () => {
      expect(service.onHandMany([])).toEqual(new Map());
    });

    it("handles more than two chunks of ids", () => {
      record({ type: "receipt", qtyMilli: 4000, unitCostPaisa: 100 });
      const ids = Array.from({ length: 1200 }, () => uuidv7());
      ids[1100] = productId;

      const result = service.onHandMany(ids);
      expect(result.size).toBe(1200);
      expect(result.get(productId)).toBe(4000);
      expect(result.get(ids[0]!)).toBe(0);
    });
  });

  describe("history", () => {
    it("returns newest first and pages", () => {
      for (const [i, qty] of [1000, 2000, 3000, 4000, 5000].entries()) {
        clock = new Date(t0.getTime() + i * 1000);
        record({ type: "return", qtyMilli: qty });
      }
      const other = addProduct().id;
      record({ productId: other, type: "return", qtyMilli: 9000 });

      expect(service.history({ productId }).map((m) => m.qtyMilli)).toEqual([
        5000, 4000, 3000, 2000, 1000,
      ]);
      expect(service.history({ productId, limit: 2, offset: 2 }).map((m) => m.qtyMilli)).toEqual([
        3000, 2000,
      ]);
    });

    it("breaks ties on id when created_at is equal", () => {
      record({ type: "return", qtyMilli: 1000 });
      record({ type: "return", qtyMilli: 2000 });
      expect(service.history({ productId }).map((m) => m.qtyMilli)).toEqual([2000, 1000]);
    });

    it("refuses a limit outside 1..200", () => {
      expect(() => service.history({ productId, limit: 0 })).toThrow();
      expect(() => service.history({ productId, limit: 201 })).toThrow();
    });
  });
});
