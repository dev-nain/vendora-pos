import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPurchaseOrderInputSchema,
  updatePurchaseOrderInputSchema,
  type CreatePurchaseOrderInput,
  type PurchaseOrder,
} from "../../shared/purchase-orders";
import { UnauthenticatedError } from "../auth/errors";
import { createSessionStore, type SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import {
  auditLog,
  categories,
  products,
  purchaseOrderLines,
  purchaseOrders,
  stockMovements,
  stores,
  suppliers,
  taxCategories,
  users,
  type ProductUnit,
} from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { openMigratedDatabase } from "../db/test-database";
import { createAuditService } from "./audit";
import { createPurchaseOrdersService } from "./purchase-orders";

const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const missingId = "01900000-0000-7000-8000-000000000001";

describe("createPurchaseOrdersService", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let service: ReturnType<typeof createPurchaseOrdersService>;
  let clock: number;
  let supplierId: string;
  let sugarId: string;
  let teaId: string;

  const storeId = () => database.db.select().from(stores).get()!.id;
  const auditRows = () => database.db.select().from(auditLog).all();
  const orderRows = () => database.db.select().from(purchaseOrders).all();
  const lineRows = () => database.db.select().from(purchaseOrderLines).all();
  const movementRows = () => database.db.select().from(stockMovements).all();
  const expectNothingWritten = () => {
    expect(orderRows()).toHaveLength(0);
    expect(lineRows()).toHaveLength(0);
    expect(auditRows()).toHaveLength(0);
  };

  const signIn = () => {
    const user = database.db
      .insert(users)
      .values({ username: "cashier", displayName: "Cashier", passwordHash: "p", pinHash: "q" })
      .returning()
      .get();
    sessions.start({ userId: user.id, storeId: storeId(), loggedInAt: new Date(0) });
    return user;
  };

  const addSupplier = (name = "Al-Noor") =>
    database.db.insert(suppliers).values({ storeId: storeId(), name }).returning().get().id;

  const addProduct = (nameEn: string, unit: ProductUnit) => {
    const category = database.db.select().from(categories).get()!;
    const tax = database.db.select().from(taxCategories).get()!;
    return database.db
      .insert(products)
      .values({
        storeId: storeId(),
        nameEn,
        nameUr: null,
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

  const orderInput = (overrides: Partial<CreatePurchaseOrderInput> = {}) =>
    createPurchaseOrderInputSchema.parse({
      supplierId,
      notes: "Friday",
      lines: [{ productId: sugarId, orderedQtyMilli: 1250, unitCostPaisa: 14333 }],
      ...overrides,
    });

  const updateOf = (id: string, overrides: Partial<CreatePurchaseOrderInput> = {}) =>
    updatePurchaseOrderInputSchema.parse({
      id,
      supplierId,
      notes: "Friday",
      lines: [{ productId: sugarId, orderedQtyMilli: 2500, unitCostPaisa: 1 }],
      ...overrides,
    });

  const created = (overrides: Partial<CreatePurchaseOrderInput> = {}): PurchaseOrder => {
    const result = service.create(orderInput(overrides));
    if (!result.ok) throw new Error(`create failed: ${result.reason}`);
    return result.order;
  };

  const confirmed = (overrides: Partial<CreatePurchaseOrderInput> = {}): PurchaseOrder => {
    const order = created(overrides);
    const result = service.confirm({ id: order.id });
    if (!result.ok) throw new Error("confirm failed");
    return result.order;
  };

  const receive = (lineId: string, qtyMilli: number) =>
    database.db
      .update(purchaseOrderLines)
      .set({ receivedQtyMilli: qtyMilli })
      .where(eq(purchaseOrderLines.id, lineId))
      .run();

  const orderSnapshot = (id: string) => {
    const result = service.get({ id });
    if (!result.ok) throw new Error("get failed");
    return result.order;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-purchase-orders-service-"));
    database = openMigratedDatabase(join(dir, "vendora.db"));
    seedStoreAndTerminal(database);
    sessions = createSessionStore();
    clock = 1_700_000_000_000;
    service = createPurchaseOrdersService({
      database,
      audit: createAuditService(database),
      sessions,
      now: () => new Date((clock += 1000)),
    });
    supplierId = addSupplier();
    sugarId = addProduct("Loose sugar", "kg");
    teaId = addProduct("Tea box", "piece");
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a draft with number, snapshots, line totals and order total", () => {
    const user = signIn();

    const order = created();

    expect(order).toMatchObject({
      orderNo: "PO-T1-000001",
      supplierId,
      supplierName: "Al-Noor",
      status: "draft",
      totalPaisa: 17916,
      lineCount: 1,
      notes: "Friday",
      createdByName: "Cashier",
    });
    expect(order.lines).toEqual([
      {
        id: expect.stringMatching(uuidV7),
        productId: sugarId,
        nameEn: "Loose sugar",
        nameUr: null,
        unit: "kg",
        orderedQtyMilli: 1250,
        unitCostPaisa: 14333,
        lineTotalPaisa: 17916,
        receivedQtyMilli: 0,
        remainingQtyMilli: 1250,
      },
    ]);
    const [row] = orderRows();
    expect(row!.id).toMatch(uuidV7);
    expect(row).toMatchObject({
      storeId: storeId(),
      createdByUserId: user.id,
      status: "draft",
      totalPaisa: 17916,
    });
    expect(row!.terminalId).toBeTruthy();
    expect(lineRows()[0]).toMatchObject({ storeId: storeId(), terminalId: row!.terminalId });
  });

  it("numbers orders in sequence", () => {
    signIn();
    expect([created().orderNo, created().orderNo]).toEqual(["PO-T1-000001", "PO-T1-000002"]);
  });

  it("rounds weighed lines half-up and sums the rounded lines", () => {
    signIn();
    const order = created({
      lines: [
        { productId: sugarId, orderedQtyMilli: 1005, unitCostPaisa: 100 },
        { productId: sugarId, orderedQtyMilli: 2500, unitCostPaisa: 1 },
      ],
    });
    expect(order.lines.map((line) => line.lineTotalPaisa)).toEqual([101, 3]);
    expect(order.totalPaisa).toBe(104);
  });

  it("keeps the snapshot when the product is renamed later", () => {
    signIn();
    const order = created();
    database.db.update(products).set({ nameEn: "Renamed" }).where(eq(products.id, sugarId)).run();
    expect(orderSnapshot(order.id).lines[0]!.nameEn).toBe("Loose sugar");
  });

  describe("create refusals", () => {
    it.each([
      ["an archived product", () => ({ deletedAt: new Date() })],
      ["an inactive product", () => ({ isActive: false })],
    ])("refuses %s", (_, change) => {
      signIn();
      database.db.update(products).set(change()).where(eq(products.id, sugarId)).run();
      expect(service.create(orderInput())).toMatchObject({
        ok: false,
        reason: "product-unavailable",
      });
      expectNothingWritten();
    });

    it("refuses the system product", () => {
      signIn();
      const misc = database.db.select().from(products).where(eq(products.isSystem, true)).get()!;
      const result = service.create(
        orderInput({ lines: [{ productId: misc.id, orderedQtyMilli: 1000, unitCostPaisa: 1 }] }),
      );
      expect(result).toMatchObject({ ok: false, reason: "product-unavailable" });
    });

    it("refuses an unknown product", () => {
      signIn();
      const result = service.create(
        orderInput({
          lines: [{ productId: missingId, orderedQtyMilli: 1000, unitCostPaisa: 1 }],
        }),
      );
      expect(result).toMatchObject({ ok: false, reason: "product-unavailable" });
      expectNothingWritten();
    });

    it("refuses an archived or unknown supplier", () => {
      signIn();
      database.db.update(suppliers).set({ deletedAt: new Date() }).run();
      expect(service.create(orderInput())).toMatchObject({
        ok: false,
        reason: "supplier-unavailable",
      });
      expect(service.create(orderInput({ supplierId: missingId }))).toMatchObject({
        ok: false,
        reason: "supplier-unavailable",
      });
      expectNothingWritten();
    });

    it("refuses a fractional piece quantity and leaves no gap in numbering", () => {
      signIn();
      const result = service.create(
        orderInput({ lines: [{ productId: teaId, orderedQtyMilli: 1500, unitCostPaisa: 100 }] }),
      );
      expect(result).toMatchObject({ ok: false, reason: "whole-units" });
      expectNothingWritten();
      expect(created().orderNo).toBe("PO-T1-000001");
    });

    it("accepts a whole piece quantity", () => {
      signIn();
      const order = created({
        lines: [{ productId: teaId, orderedQtyMilli: 3000, unitCostPaisa: 100 }],
      });
      expect(order.totalPaisa).toBe(300);
    });
  });

  describe("update", () => {
    it("replaces lines, recalculates the total and keeps number and status in a draft", () => {
      signIn();
      const order = created();

      const result = service.update(updateOf(order.id, { notes: null }));

      expect(result).toMatchObject({
        ok: true,
        order: { orderNo: order.orderNo, status: "draft", totalPaisa: 3, notes: null },
      });
      const live = lineRows().filter((line) => line.deletedAt === null);
      expect(live).toHaveLength(1);
      expect(lineRows()).toHaveLength(2);
    });

    it("works on a confirmed order", () => {
      signIn();
      const order = confirmed();
      const result = service.update(
        updateOf(order.id, {
          lines: [
            { productId: sugarId, orderedQtyMilli: 1000, unitCostPaisa: 200 },
            { productId: teaId, orderedQtyMilli: 2000, unitCostPaisa: 50 },
          ],
        }),
      );
      expect(result).toMatchObject({
        ok: true,
        order: { status: "confirmed", totalPaisa: 300, lineCount: 2 },
      });
    });

    it("keeps a product and supplier already on the order after they are archived", () => {
      signIn();
      const order = created();
      database.db.update(products).set({ deletedAt: new Date() }).run();
      database.db.update(suppliers).set({ deletedAt: new Date() }).run();

      const result = service.update(updateOf(order.id));

      expect(result).toMatchObject({ ok: true, order: { totalPaisa: 3 } });
    });

    it("refuses a newly added archived product or supplier", () => {
      signIn();
      const order = created();
      database.db
        .update(products)
        .set({ deletedAt: new Date() })
        .where(eq(products.id, teaId))
        .run();
      const otherSupplier = addSupplier("Other");
      database.db
        .update(suppliers)
        .set({ deletedAt: new Date() })
        .where(eq(suppliers.id, otherSupplier))
        .run();

      expect(
        service.update(
          updateOf(order.id, {
            lines: [{ productId: teaId, orderedQtyMilli: 1000, unitCostPaisa: 1 }],
          }),
        ),
      ).toMatchObject({ ok: false, reason: "product-unavailable" });
      expect(service.update(updateOf(order.id, { supplierId: otherSupplier }))).toMatchObject({
        ok: false,
        reason: "supplier-unavailable",
      });
      expect(orderSnapshot(order.id).totalPaisa).toBe(17916);
    });

    it("refuses a fractional piece quantity", () => {
      signIn();
      const order = created();
      const result = service.update(
        updateOf(order.id, {
          lines: [{ productId: teaId, orderedQtyMilli: 1500, unitCostPaisa: 1 }],
        }),
      );
      expect(result).toMatchObject({ ok: false, reason: "whole-units" });
    });

    it("is refused after the first receipt, on cancelled and on received orders", () => {
      signIn();
      const partly = confirmed();
      receive(partly.lines[0]!.id, 400);
      expect(service.update(updateOf(partly.id))).toMatchObject({
        ok: false,
        reason: "not-editable",
      });

      const received = confirmed();
      receive(received.lines[0]!.id, 1250);
      expect(service.update(updateOf(received.id))).toMatchObject({
        ok: false,
        reason: "not-editable",
      });

      const cancelled = created();
      service.cancel({ id: cancelled.id });
      expect(service.update(updateOf(cancelled.id))).toMatchObject({
        ok: false,
        reason: "not-editable",
      });
    });

    it("reads an unknown order as not found", () => {
      signIn();
      expect(service.update(updateOf(missingId))).toMatchObject({
        ok: false,
        reason: "not-found",
      });
    });
  });

  describe("status changes", () => {
    it("moves Draft to Confirmed", () => {
      signIn();
      const order = created();
      expect(service.confirm({ id: order.id })).toMatchObject({
        ok: true,
        order: { status: "confirmed" },
      });
    });

    it("moves Confirmed to Partly received to Received from the received quantity", () => {
      signIn();
      const order = confirmed({
        lines: [
          { productId: sugarId, orderedQtyMilli: 1000, unitCostPaisa: 100 },
          { productId: teaId, orderedQtyMilli: 2000, unitCostPaisa: 100 },
        ],
      });
      const [first, second] = order.lines;

      receive(first!.id, 1000);
      expect(orderSnapshot(order.id).status).toBe("partly_received");

      receive(second!.id, 2000);
      expect(orderSnapshot(order.id).status).toBe("received");
    });

    it.each([
      ["Draft", false, 0],
      ["Confirmed", true, 0],
      ["Partly received", true, 400],
    ])("cancels from %s", (_, confirm, receivedQty) => {
      signIn();
      const order = confirm ? confirmed() : created();
      if (receivedQty > 0) receive(order.lines[0]!.id, receivedQty);

      expect(service.cancel({ id: order.id })).toMatchObject({
        ok: true,
        order: { status: "cancelled" },
      });
    });

    it("refuses to confirm unless the order is a draft", () => {
      signIn();
      const order = confirmed();
      expect(service.confirm({ id: order.id })).toMatchObject({
        ok: false,
        reason: "not-confirmable",
      });
      service.cancel({ id: order.id });
      expect(service.confirm({ id: order.id })).toMatchObject({
        ok: false,
        reason: "not-confirmable",
      });
      expect(service.confirm({ id: missingId })).toMatchObject({ ok: false, reason: "not-found" });
    });

    it("keeps ordered and received quantities on a partial cancel", () => {
      signIn();
      const order = confirmed();
      receive(order.lines[0]!.id, 400);

      const result = service.cancel({ id: order.id });

      if (!result.ok) throw new Error("cancel failed");
      expect(result.order.status).toBe("cancelled");
      expect(result.order.totalPaisa).toBe(17916);
      expect(result.order.lines[0]).toMatchObject({
        orderedQtyMilli: 1250,
        receivedQtyMilli: 400,
        remainingQtyMilli: 0,
      });
      expect(lineRows()[0]).toMatchObject({ orderedQtyMilli: 1250, receivedQtyMilli: 400 });
    });

    it("refuses to cancel a received or cancelled order", () => {
      signIn();
      const received = confirmed();
      receive(received.lines[0]!.id, 1250);
      expect(service.cancel({ id: received.id })).toMatchObject({
        ok: false,
        reason: "not-cancellable",
      });

      const cancelled = created();
      service.cancel({ id: cancelled.id });
      expect(service.cancel({ id: cancelled.id })).toMatchObject({
        ok: false,
        reason: "not-cancellable",
      });
      expect(service.cancel({ id: missingId })).toMatchObject({ ok: false, reason: "not-found" });
    });
  });

  it("audits create, confirm and cancel with the actor, and nothing else", () => {
    const user = signIn();
    const order = created();
    service.update(updateOf(order.id));
    service.confirm({ id: order.id });
    service.confirm({ id: order.id });
    service.cancel({ id: order.id });
    service.cancel({ id: order.id });

    const rows = auditRows();
    expect(rows.map((row) => row.action)).toEqual([
      "purchase_order_create",
      "purchase_order_confirm",
      "purchase_order_cancel",
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({
        actorUserId: user.id,
        entityType: "purchase_order",
        entityId: order.id,
      });
    }
    expect(JSON.parse(rows[0]!.details!)).toEqual({
      orderNo: "PO-T1-000001",
      supplierId,
      totalPaisa: 17916,
      lineCount: 1,
    });
    expect(JSON.parse(rows[1]!.details!)).toEqual({ orderNo: "PO-T1-000001" });
    expect(JSON.parse(rows[2]!.details!)).toEqual({ orderNo: "PO-T1-000001", from: "confirmed" });
  });

  it("records the status before a partial cancel", () => {
    signIn();
    const order = confirmed();
    receive(order.lines[0]!.id, 400);
    service.cancel({ id: order.id });
    expect(JSON.parse(auditRows().at(-1)!.details!)).toMatchObject({ from: "partly_received" });
  });

  it("never writes a stock movement", () => {
    signIn();
    const order = created();
    service.update(updateOf(order.id));
    service.confirm({ id: order.id });
    receive(orderSnapshot(order.id).lines[0]!.id, 400);
    service.cancel({ id: order.id });
    expect(movementRows()).toHaveLength(0);
  });

  it("refuses every method with no session and writes nothing", () => {
    expect(() => service.list()).toThrow(UnauthenticatedError);
    expect(() => service.get({ id: missingId })).toThrow(UnauthenticatedError);
    expect(() => service.create(orderInput())).toThrow(UnauthenticatedError);
    expect(() => service.update(updateOf(missingId))).toThrow(UnauthenticatedError);
    expect(() => service.confirm({ id: missingId })).toThrow(UnauthenticatedError);
    expect(() => service.cancel({ id: missingId })).toThrow(UnauthenticatedError);
    expect(orderRows()).toHaveLength(0);
    expect(auditRows()).toHaveLength(0);
  });

  it("reads an order from another store as not found", () => {
    signIn();
    const order = created();
    const otherStore = database.db.insert(stores).values({}).returning().get().id;
    sessions.end();
    const user = database.db.select().from(users).get()!;
    sessions.start({ userId: user.id, storeId: otherStore, loggedInAt: new Date(0) });

    expect(service.get({ id: order.id })).toMatchObject({ ok: false, reason: "not-found" });
    expect(service.update(updateOf(order.id))).toMatchObject({ ok: false, reason: "not-found" });
    expect(service.confirm({ id: order.id })).toMatchObject({ ok: false, reason: "not-found" });
    expect(service.cancel({ id: order.id })).toMatchObject({ ok: false, reason: "not-found" });
    expect(service.list()).toEqual([]);
  });

  it("lists newest first with derived statuses and live line counts", () => {
    signIn();
    const first = confirmed();
    receive(first.lines[0]!.id, 400);
    const second = created();
    service.update(
      updateOf(second.id, {
        lines: [
          { productId: sugarId, orderedQtyMilli: 1000, unitCostPaisa: 100 },
          { productId: teaId, orderedQtyMilli: 1000, unitCostPaisa: 100 },
        ],
      }),
    );

    const list = service.list();

    expect(list.map((o) => [o.orderNo, o.status, o.lineCount, o.supplierName])).toEqual([
      ["PO-T1-000002", "draft", 2, "Al-Noor"],
      ["PO-T1-000001", "partly_received", 1, "Al-Noor"],
    ]);
  });
});
