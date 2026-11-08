import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postGoodsReceivedInputSchema } from "../../shared/goods-received";
import { postPurchaseReturnInputSchema } from "../../shared/purchase-returns";
import { UnauthenticatedError } from "../auth/errors";
import { createSessionStore, type SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { categories, products, stores, suppliers, taxCategories, users } from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { openMigratedDatabase } from "../db/test-database";
import { createAuditService } from "./audit";
import { createGoodsReceivedService } from "./goods-received";
import { createPurchaseHistoryService } from "./purchase-history";
import { createPurchaseReturnsService } from "./purchase-returns";
import { createStockService } from "./stock";

const missingId = "01900000-0000-7000-8000-000000000001";

describe("createPurchaseHistoryService", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let grn: ReturnType<typeof createGoodsReceivedService>;
  let returns: ReturnType<typeof createPurchaseReturnsService>;
  let service: ReturnType<typeof createPurchaseHistoryService>;
  let clock: number;
  let supplierA: string;
  let supplierB: string;
  let teaId: string;
  let sugarId: string;

  const storeId = () => database.db.select().from(stores).get()!.id;

  const newProduct = (nameEn: string, unit: "piece" | "kg") => {
    const category = database.db.select().from(categories).get()!;
    const tax = database.db.select().from(taxCategories).get()!;
    return database.db
      .insert(products)
      .values({
        storeId: storeId(),
        nameEn,
        searchText: nameEn.toLowerCase(),
        categoryId: category.id,
        taxCategoryId: tax.id,
        unit,
        costPaisa: 100,
        salePricePaisa: 150,
      })
      .returning()
      .get().id;
  };

  const receive = (productId: string, supplierId: string, qtyMilli: number, cost: number) => {
    const result = grn.post(
      postGoodsReceivedInputSchema.parse({
        kind: "direct",
        supplierId,
        supplierInvoiceNo: "INV-1",
        lines: [{ productId, qtyMilli, unitCostPaisa: cost }],
      }),
    );
    if (!result.ok) throw new Error(result.reason);
    return result.note;
  };

  const giveBack = (productId: string, supplierId: string, qtyMilli: number) => {
    const result = returns.post(
      postPurchaseReturnInputSchema.parse({
        kind: "supplier",
        supplierId,
        reason: "damaged",
        notes: null,
        lines: [{ productId, qtyMilli }],
      }),
    );
    if (!result.ok) throw new Error(result.reason);
    return result.purchaseReturn;
  };

  const forProduct = (productId: string, limit = 50, offset = 0) => {
    const result = service.forProduct({ productId, limit, offset });
    if (!result.ok) throw new Error("not found");
    return result;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-purchase-history-"));
    database = openMigratedDatabase(join(dir, "vendora.db"));
    seedStoreAndTerminal(database);
    sessions = createSessionStore();
    clock = 1_700_000_000_000;
    const audit = createAuditService(database);
    const stock = createStockService({ database, audit });
    const now = () => new Date((clock += 1000));
    grn = createGoodsReceivedService({ database, audit, sessions, stock, now });
    returns = createPurchaseReturnsService({ database, audit, sessions, stock, now });
    service = createPurchaseHistoryService({ database, sessions });
    supplierA = database.db
      .insert(suppliers)
      .values({ storeId: storeId(), name: "Al-Noor" })
      .returning()
      .get().id;
    supplierB = database.db
      .insert(suppliers)
      .values({ storeId: storeId(), name: "Rehman Traders" })
      .returning()
      .get().id;
    teaId = newProduct("Tea box", "piece");
    sugarId = newProduct("Loose sugar", "kg");
    const userId = database.db
      .insert(users)
      .values({ username: "cashier", displayName: "Cashier", passwordHash: "p", pinHash: "q" })
      .returning()
      .get().id;
    sessions.start({ userId, storeId: storeId(), loggedInAt: new Date(0) });
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists receipts and returns newest first and tracks the last receipt", () => {
    const noteA = receive(teaId, supplierA, 10000, 10000);
    const noteB = receive(teaId, supplierB, 10000, 10500);
    const returnA = giveBack(teaId, supplierA, 2000);

    const result = forProduct(teaId);
    expect(result.items.map((row) => [row.kind, row.documentNo, row.qtyMilli])).toEqual([
      ["return", returnA.returnNo, -2000],
      ["receipt", noteB.grnNo, 10000],
      ["receipt", noteA.grnNo, 10000],
    ]);
    expect(result.items[0]).toMatchObject({
      documentId: returnA.id,
      productId: teaId,
      nameEn: "Tea box",
      unit: "piece",
      supplierId: supplierA,
      supplierName: "Al-Noor",
      unitCostPaisa: 10000,
      lineTotalPaisa: -20000,
      createdAt: returnA.createdAt,
    });
    expect(result.items[1]).toMatchObject({
      lineTotalPaisa: 105000,
      supplierName: "Rehman Traders",
    });
    expect(result.hasMore).toBe(false);
    expect(result.lastReceipt).toMatchObject({
      unitCostPaisa: 10500,
      supplierId: supplierB,
      supplierName: "Rehman Traders",
      grnNo: noteB.grnNo,
    });

    giveBack(teaId, supplierB, 1000);
    expect(forProduct(teaId).lastReceipt).toMatchObject({
      unitCostPaisa: 10500,
      supplierId: supplierB,
    });

    const noteC = receive(teaId, supplierA, 10000, 9800);
    expect(forProduct(teaId).lastReceipt).toMatchObject({
      unitCostPaisa: 9800,
      supplierId: supplierA,
      grnNo: noteC.grnNo,
    });
  });

  it("gives no last receipt for a product never received", () => {
    expect(forProduct(teaId)).toMatchObject({ lastReceipt: null, items: [], hasMore: false });
  });

  it("lists only that supplier's rows on the supplier view", () => {
    receive(teaId, supplierA, 10000, 10000);
    receive(sugarId, supplierB, 10000, 5000);
    giveBack(teaId, supplierA, 1000);

    const result = service.forSupplier({ supplierId: supplierA, limit: 50, offset: 0 });

    expect(result).toMatchObject({ ok: true, supplier: { id: supplierA, name: "Al-Noor" } });
    if (!result.ok) return;
    expect(result.items.map((row) => [row.kind, row.nameEn])).toEqual([
      ["return", "Tea box"],
      ["receipt", "Tea box"],
    ]);
  });

  it("pages with hasMore", () => {
    for (let i = 0; i < 3; i += 1) receive(teaId, supplierA, 1000, 100);

    const first = forProduct(teaId, 2, 0);
    const second = forProduct(teaId, 2, 2);

    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(3);
  });

  it("refuses an id from no store and still shows an archived supplier's history", () => {
    expect(service.forProduct({ productId: missingId, limit: 10, offset: 0 })).toMatchObject({
      ok: false,
      reason: "not-found",
    });
    expect(service.forSupplier({ supplierId: missingId, limit: 10, offset: 0 })).toMatchObject({
      ok: false,
      reason: "not-found",
    });

    receive(teaId, supplierA, 1000, 100);
    database.db
      .update(suppliers)
      .set({ deletedAt: new Date() })
      .where(eq(suppliers.id, supplierA))
      .run();
    const result = service.forSupplier({ supplierId: supplierA, limit: 10, offset: 0 });
    expect(result.ok && result.items).toHaveLength(1);
  });

  it("keeps the goods received last cost reading the same row", () => {
    receive(teaId, supplierA, 1000, 100);
    receive(teaId, supplierB, 1000, 105);
    expect(grn.lastCost({ productId: teaId })).toEqual({ unitCostPaisa: 105 });
    expect(grn.lastCost({ productId: sugarId })).toEqual({ unitCostPaisa: null });
  });

  it("throws when signed out", () => {
    sessions.end();
    expect(() => service.forProduct({ productId: teaId, limit: 10, offset: 0 })).toThrow(
      UnauthenticatedError,
    );
    expect(() => service.forSupplier({ supplierId: supplierA, limit: 10, offset: 0 })).toThrow(
      UnauthenticatedError,
    );
  });
});
