import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  postGoodsReceivedInputSchema,
  type PostGoodsReceivedInput,
  type PostGoodsReceivedResult,
} from "../../shared/goods-received";
import { ipcChannels } from "../../shared/ipc";
import { priceUpdateInput, updateProductInputSchema } from "../../shared/products";
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
  goodsReceivedLines,
  goodsReceivedNotes,
  products,
  purchaseOrderLines,
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
import { createGoodsReceivedService } from "./goods-received";
import { createProductsService } from "./products";
import { createPurchaseOrdersService } from "./purchase-orders";
import { createStockService, type StockService } from "./stock";

const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const missingId = "01900000-0000-7000-8000-000000000001";

const fromOrder = (
  order: PurchaseOrder,
  lines: { index: number; qtyMilli: number; unitCostPaisa: number }[],
  overrides: Record<string, unknown> = {},
) =>
  postGoodsReceivedInputSchema.parse({
    kind: "order",
    purchaseOrderId: order.id,
    supplierInvoiceNo: "INV-2",
    lines: lines.map(({ index, ...rest }) => ({
      purchaseOrderLineId: order.lines[index]!.id,
      ...rest,
    })),
    ...overrides,
  });

const lineOf = (productId: string, qtyMilli = 1000) => ({
  productId,
  qtyMilli,
  unitCostPaisa: 100,
});

describe("createGoodsReceivedService", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let audit: ReturnType<typeof createAuditService>;
  let stock: StockService;
  let service: ReturnType<typeof createGoodsReceivedService>;
  let orders: ReturnType<typeof createPurchaseOrdersService>;
  let clock: number;
  let supplierId: string;
  let sugarId: string;
  let teaId: string;
  let userId: string;

  const storeId = () => database.db.select().from(stores).get()!.id;
  const auditRows = (action: string) =>
    database.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, action as never))
      .all();
  const noteRows = () => database.db.select().from(goodsReceivedNotes).all();
  const lineRows = () => database.db.select().from(goodsReceivedLines).all();
  const movementRows = () => database.db.select().from(stockMovements).all();
  const costOf = (id: string) =>
    database.db.select().from(products).where(eq(products.id, id)).get()!.costPaisa;
  const expectNothingWritten = () => {
    expect(noteRows()).toHaveLength(0);
    expect(lineRows()).toHaveLength(0);
    expect(movementRows()).toHaveLength(0);
    expect(auditRows("goods_received_post")).toHaveLength(0);
    expect(auditRows("cost_change")).toHaveLength(0);
  };

  const newProduct = (nameEn: string, unit: ProductUnit, overrides = {}) => {
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
        ...overrides,
      })
      .returning()
      .get().id;
  };

  const direct = (
    lines: { productId: string; qtyMilli: number; unitCostPaisa: number }[],
    overrides: Record<string, unknown> = {},
  ) =>
    postGoodsReceivedInputSchema.parse({
      kind: "direct",
      supplierId,
      supplierInvoiceNo: "INV-1",
      lines,
      ...overrides,
    });

  const posted = (input: PostGoodsReceivedInput) => {
    const result = service.post(postGoodsReceivedInputSchema.parse(input));
    if (!result.ok) throw new Error(`post failed: ${result.reason}`);
    return result.note;
  };

  const confirmedOrder = (lines?: CreatePurchaseOrderInput["lines"]): PurchaseOrder => {
    const created = orders.create(
      createPurchaseOrderInputSchema.parse({
        supplierId,
        notes: null,
        lines: lines ?? [{ productId: sugarId, orderedQtyMilli: 5000, unitCostPaisa: 14000 }],
      }),
    );
    if (!created.ok) throw new Error("create failed");
    const confirmed = orders.confirm({ id: created.order.id });
    if (!confirmed.ok) throw new Error("confirm failed");
    return confirmed.order;
  };

  const orderNow = (id: string) => {
    const result = orders.get({ id });
    if (!result.ok) throw new Error("get failed");
    return result.order;
  };

  const listAll = (overrides = {}) => service.list({ limit: 50, offset: 0, ...overrides });
  const at = (iso: string) => {
    clock = new Date(iso).getTime() - 1000;
  };

  const twoLineOrder = () =>
    confirmedOrder([
      { productId: sugarId, orderedQtyMilli: 5000, unitCostPaisa: 14000 },
      { productId: teaId, orderedQtyMilli: 3000, unitCostPaisa: 500 },
    ]);

  const build = (stockService: Pick<StockService, "record">, auditService = audit) =>
    createGoodsReceivedService({
      database,
      audit: auditService,
      sessions,
      stock: stockService,
      now: () => new Date((clock += 1000)),
    });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-goods-received-service-"));
    database = openMigratedDatabase(join(dir, "vendora.db"));
    seedStoreAndTerminal(database);
    sessions = createSessionStore();
    clock = 1_700_000_000_000;
    audit = createAuditService(database);
    stock = createStockService({ database, audit });
    service = build(stock);
    orders = createPurchaseOrdersService({ database, audit, sessions });
    supplierId = database.db
      .insert(suppliers)
      .values({ storeId: storeId(), name: "Al-Noor" })
      .returning()
      .get().id;
    sugarId = newProduct("Loose sugar", "kg");
    teaId = newProduct("Tea box", "piece");
    userId = database.db
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

  const twoLines = () =>
    direct([
      { productId: sugarId, qtyMilli: 1000, unitCostPaisa: 20000 },
      { productId: teaId, qtyMilli: 2000, unitCostPaisa: 900 },
    ]);

  const expectUntouched = (order?: PurchaseOrder) => {
    expectNothingWritten();
    expect(costOf(sugarId)).toBe(100);
    expect(costOf(teaId)).toBe(100);
    if (order) {
      expect(orderNow(order.id).lines.map((line) => line.receivedQtyMilli)).toEqual([0]);
    }
    expect(posted(direct([{ productId: sugarId, qtyMilli: 1000, unitCostPaisa: 100 }])).grnNo).toBe(
      "GRN-T1-000001",
    );
  };

  const expectRefused = (result: PostGoodsReceivedResult, reason: string) => {
    expect(result).toMatchObject({ ok: false, reason });
    expectNothingWritten();
  };

  const receive = (qtyMilli: number, unitCostPaisa: number) =>
    posted(direct([{ productId: sugarId, qtyMilli, unitCostPaisa }]));

  const setStore = (values: Partial<typeof stores.$inferInsert>) =>
    database.db.update(stores).set(values).run();

  const receiveAt = (productId: string, unitCostPaisa: number) =>
    posted(direct([{ productId, qtyMilli: 1000, unitCostPaisa }]));

  const lowMargin = (id: string) => {
    const result = service.lowMargin({ id });
    if (!result.ok) throw new Error("not found");
    return result;
  };

  const priced = (name: string, salePricePaisa: number, overrides = {}) =>
    newProduct(name, "piece", { costPaisa: 0, salePricePaisa, ...overrides });

  describe("direct", () => {
    it("writes the note, line, movement, stock, cost and audit row", () => {
      const note = posted(
        direct([{ productId: sugarId, qtyMilli: 10000, unitCostPaisa: 12000 }], {
          supplierInvoiceNo: "INV-100",
        }),
      );

      expect(note).toMatchObject({
        grnNo: "GRN-T1-000001",
        supplierId,
        supplierName: "Al-Noor",
        purchaseOrderId: null,
        supplierInvoiceNo: "INV-100",
        totalPaisa: 120000,
      });
      const [row] = noteRows();
      expect(row).toMatchObject({
        id: note.id,
        storeId: storeId(),
        terminalId: expect.any(String),
        actorUserId: userId,
        purchaseOrderId: null,
      });
      expect(row!.id).toMatch(uuidV7);
      const [line] = lineRows();
      expect(line).toMatchObject({
        id: note.lines[0]!.id,
        goodsReceivedNoteId: note.id,
        position: 0,
        productId: sugarId,
        purchaseOrderLineId: null,
        nameEn: "Loose sugar",
        nameUr: null,
        unit: "kg",
        qtyMilli: 10000,
        unitCostPaisa: 12000,
        lineTotalPaisa: 120000,
        storeId: storeId(),
        terminalId: row!.terminalId,
      });
      expect(line!.id).toMatch(uuidV7);
      const movements = movementRows();
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        type: "receipt",
        productId: sugarId,
        qtyMilli: 10000,
        unitCostPaisa: 12000,
        sourceType: "goods_received_line",
        sourceId: line!.id,
        actorUserId: userId,
      });
      expect(stock.onHand(sugarId)).toBe(10000);
      expect(costOf(sugarId)).toBe(12000);
      const audits = auditRows("goods_received_post");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actorUserId: userId,
        entityType: "goods_received_note",
        entityId: note.id,
      });
      expect(JSON.parse(audits[0]!.details ?? "null")).toEqual({
        grnNo: "GRN-T1-000001",
        supplierId,
        purchaseOrderId: null,
        supplierInvoiceNo: "INV-100",
        totalPaisa: 120000,
        lineCount: 1,
      });
    });

    it("rounds the line half-up and sums the rounded lines", () => {
      expect(
        posted(direct([{ productId: sugarId, qtyMilli: 1250, unitCostPaisa: 14333 }])).totalPaisa,
      ).toBe(17916);

      const note = posted(
        direct([
          { productId: sugarId, qtyMilli: 500, unitCostPaisa: 1 },
          { productId: teaId, qtyMilli: 1000, unitCostPaisa: 0 },
          { productId: sugarId, qtyMilli: 500, unitCostPaisa: 1 },
        ]),
      );
      expect(note.lines.map((line) => line.lineTotalPaisa)).toEqual([1, 0, 1]);
      expect(note.totalPaisa).toBe(2);
    });

    it("numbers notes per terminal in sequence", () => {
      const first = posted(direct([{ productId: sugarId, qtyMilli: 1000, unitCostPaisa: 100 }]));
      const second = posted(direct([{ productId: sugarId, qtyMilli: 1000, unitCostPaisa: 100 }]));
      expect([first.grnNo, second.grnNo]).toEqual(["GRN-T1-000001", "GRN-T1-000002"]);
    });
  });

  describe("against an order", () => {
    it("updates the received quantity and takes the supplier from the order", () => {
      const order = confirmedOrder();

      const note = posted(
        fromOrder(order, [{ index: 0, qtyMilli: 2000, unitCostPaisa: 14000 }], {
          supplierInvoiceNo: "INV-101",
        }),
      );

      expect(note).toMatchObject({
        purchaseOrderId: order.id,
        supplierId,
        totalPaisa: 28000,
        supplierInvoiceNo: "INV-101",
      });
      expect(note.lines[0]).toMatchObject({
        purchaseOrderLineId: order.lines[0]!.id,
        productId: sugarId,
      });
      const after = orderNow(order.id);
      expect(after.status).toBe("partly_received");
      expect(after.lines[0]).toMatchObject({ receivedQtyMilli: 2000, remainingQtyMilli: 3000 });
      expect(movementRows()[0]!.sourceId).toBe(note.lines[0]!.id);
    });

    it("moves from confirmed to partly received to received", () => {
      const order = twoLineOrder();
      expect(order.status).toBe("confirmed");

      posted(fromOrder(order, [{ index: 0, qtyMilli: 5000, unitCostPaisa: 14000 }]));
      const partial = orderNow(order.id);
      expect(partial.status).toBe("partly_received");
      expect(partial.lines.map((line) => line.remainingQtyMilli)).toEqual([0, 3000]);

      posted(fromOrder(order, [{ index: 1, qtyMilli: 3000, unitCostPaisa: 500 }]));
      const full = orderNow(order.id);
      expect(full.status).toBe("received");
      expect(full.lines.map((line) => line.remainingQtyMilli)).toEqual([0, 0]);
    });

    it("accepts more than ordered and reads as received", () => {
      const order = confirmedOrder();

      posted(fromOrder(order, [{ index: 0, qtyMilli: 6000, unitCostPaisa: 14000 }]));

      expect(stock.onHand(sugarId)).toBe(6000);
      expect(costOf(sugarId)).toBe(14000);
      const after = orderNow(order.id);
      expect(after.status).toBe("received");
      expect(after.lines[0]).toMatchObject({ receivedQtyMilli: 6000, remainingQtyMilli: 0 });
    });

    it("stays partly received when one line is over and another is short", () => {
      const order = twoLineOrder();

      posted(fromOrder(order, [{ index: 0, qtyMilli: 9000, unitCostPaisa: 14000 }]));

      expect(orderNow(order.id).status).toBe("partly_received");
    });

    it("adds two GRN lines on the same order line together", () => {
      const order = confirmedOrder();

      posted(
        fromOrder(order, [
          { index: 0, qtyMilli: 1000, unitCostPaisa: 14000 },
          { index: 0, qtyMilli: 1500, unitCostPaisa: 14000 },
        ]),
      );

      expect(orderNow(order.id).lines[0]!.receivedQtyMilli).toBe(2500);
    });

    it("credits the exact line when a product is on the order twice", () => {
      const order = confirmedOrder([
        { productId: sugarId, orderedQtyMilli: 2000, unitCostPaisa: 100 },
        { productId: sugarId, orderedQtyMilli: 3000, unitCostPaisa: 100 },
      ]);

      posted(fromOrder(order, [{ index: 1, qtyMilli: 3000, unitCostPaisa: 100 }]));

      const after = orderNow(order.id);
      expect(after.lines.map((line) => line.receivedQtyMilli)).toEqual([0, 3000]);
      expect(after.status).toBe("partly_received");
    });

    it("accepts an order whose supplier was archived", () => {
      const order = confirmedOrder();
      database.db
        .update(suppliers)
        .set({ deletedAt: new Date() })
        .where(eq(suppliers.id, supplierId))
        .run();

      expect(
        service.post(fromOrder(order, [{ index: 0, qtyMilli: 1000, unitCostPaisa: 14000 }])).ok,
      ).toBe(true);
    });
  });

  describe("average cost", () => {
    it("averages across several receipts", () => {
      receive(10000, 12000);
      expect(costOf(sugarId)).toBe(12000);
      receive(2000, 14000);
      expect(costOf(sugarId)).toBe(12333);
      receive(4000, 14000);
      expect(costOf(sugarId)).toBe(12750);
    });

    it("takes the incoming cost when nothing is on hand", () => {
      receive(1000, 5000);
      expect(costOf(sugarId)).toBe(5000);
    });

    it("takes the incoming cost when stock is negative", () => {
      database.db.transaction((tx) =>
        stock.record(tx, {
          productId: sugarId,
          type: "sale",
          qtyMilli: -3000,
          actorUserId: userId,
        }),
      );
      receive(2000, 9000);
      expect(costOf(sugarId)).toBe(9000);
    });

    it("averages the same product twice in one note line by line", () => {
      posted(
        direct([
          { productId: sugarId, qtyMilli: 1000, unitCostPaisa: 10000 },
          { productId: sugarId, qtyMilli: 1000, unitCostPaisa: 20000 },
        ]),
      );
      expect(costOf(sugarId)).toBe(15000);
    });

    it("averages down on a zero unit cost", () => {
      receive(1000, 10000);
      receive(1000, 0);
      expect(costOf(sugarId)).toBe(5000);
    });

    it("writes one cost_change per stored change and none when unchanged", () => {
      receive(1000, 10000);
      expect(auditRows("cost_change")).toHaveLength(1);
      receive(1000, 10000);
      expect(auditRows("cost_change")).toHaveLength(1);
      receive(1000, 20000);
      expect(auditRows("cost_change")).toHaveLength(2);
      expect(auditRows("cost_change").every((row) => row.actorUserId === userId)).toBe(true);
    });
  });

  describe("refusals", () => {
    afterEach(() => {
      const next = posted(direct([lineOf(sugarId)]));
      expect(next.grnNo).toBe("GRN-T1-000001");
    });

    it("refuses an archived supplier", () => {
      database.db
        .update(suppliers)
        .set({ deletedAt: new Date() })
        .where(eq(suppliers.id, supplierId))
        .run();
      expectRefused(service.post(direct([lineOf(sugarId)])), "supplier-unavailable");
      database.db.update(suppliers).set({ deletedAt: null }).run();
    });

    it("refuses an unknown supplier", () => {
      expectRefused(
        service.post(direct([lineOf(sugarId)], { supplierId: missingId })),
        "supplier-unavailable",
      );
    });

    it.each([
      ["archived", { isActive: false }],
      ["deleted", { deletedAt: new Date() }],
      ["system", { isSystem: true }],
    ])("refuses an %s product", (_, overrides) => {
      const id = newProduct("Other", "kg", overrides);
      expectRefused(service.post(direct([lineOf(id)])), "product-unavailable");
    });

    it("refuses an unknown product", () => {
      expectRefused(service.post(direct([lineOf(missingId)])), "product-unavailable");
    });

    it("refuses a fractional piece", () => {
      expectRefused(service.post(direct([lineOf(teaId, 1500)])), "whole-units");
    });

    it("refuses an unknown order", () => {
      const order = confirmedOrder();
      expectRefused(
        service.post(
          fromOrder(order, [{ index: 0, qtyMilli: 1, unitCostPaisa: 1 }], {
            purchaseOrderId: missingId,
          }),
        ),
        "order-not-found",
      );
    });

    it("refuses a draft order", () => {
      const created = orders.create(
        createPurchaseOrderInputSchema.parse({
          supplierId,
          notes: null,
          lines: [{ productId: sugarId, orderedQtyMilli: 1000, unitCostPaisa: 100 }],
        }),
      );
      if (!created.ok) throw new Error("create failed");
      expectRefused(
        service.post(fromOrder(created.order, [{ index: 0, qtyMilli: 1, unitCostPaisa: 1 }])),
        "order-not-receivable",
      );
    });

    it("refuses a cancelled order", () => {
      const order = confirmedOrder();
      orders.cancel({ id: order.id });
      expectRefused(
        service.post(fromOrder(order, [{ index: 0, qtyMilli: 1, unitCostPaisa: 1 }])),
        "order-not-receivable",
      );
    });

    it("refuses a fully received order", () => {
      const order = confirmedOrder();
      database.db
        .update(purchaseOrderLines)
        .set({ receivedQtyMilli: 5000 })
        .where(eq(purchaseOrderLines.id, order.lines[0]!.id))
        .run();
      expectRefused(
        service.post(fromOrder(order, [{ index: 0, qtyMilli: 1, unitCostPaisa: 1 }])),
        "order-not-receivable",
      );
    });

    it("refuses a line from another order", () => {
      const order = confirmedOrder();
      const other = confirmedOrder();
      const input = postGoodsReceivedInputSchema.parse({
        kind: "order",
        purchaseOrderId: order.id,
        supplierInvoiceNo: "INV-2",
        lines: [{ purchaseOrderLineId: other.lines[0]!.id, qtyMilli: 1, unitCostPaisa: 1 }],
      });
      expectRefused(service.post(input), "order-line-unavailable");
    });

    it("refuses a line replaced by an order edit", () => {
      const order = confirmedOrder();
      const updated = orders.update(
        updatePurchaseOrderInputSchema.parse({
          id: order.id,
          supplierId,
          notes: null,
          lines: [{ productId: teaId, orderedQtyMilli: 1000, unitCostPaisa: 100 }],
        }),
      );
      expect(updated.ok).toBe(true);
      expectRefused(
        service.post(fromOrder(order, [{ index: 0, qtyMilli: 1, unitCostPaisa: 1 }])),
        "order-line-unavailable",
      );
    });

    it("refuses an order line whose product was archived", () => {
      const order = confirmedOrder();
      database.db.update(products).set({ isActive: false }).where(eq(products.id, sugarId)).run();
      expectRefused(
        service.post(fromOrder(order, [{ index: 0, qtyMilli: 1, unitCostPaisa: 1 }])),
        "product-unavailable",
      );
      database.db.update(products).set({ isActive: true }).where(eq(products.id, sugarId)).run();
    });
  });

  describe("rollback", () => {
    it("undoes everything when the second stock movement fails", () => {
      let calls = 0;
      const failing = build({
        record: (tx, input) => {
          calls += 1;
          if (calls === 2) throw new Error("disk full");
          return stock.record(tx, input);
        },
      });

      expect(() => failing.post(twoLines())).toThrow("disk full");

      expectUntouched();
    });

    it("undoes everything when the audit write fails", () => {
      const order = confirmedOrder();
      const failing = build(stock, {
        ...audit,
        record: (input, executor) => {
          if (input.action === "goods_received_post") throw new Error("audit down");
          return audit.record(input, executor);
        },
      });

      expect(() =>
        failing.post(fromOrder(order, [{ index: 0, qtyMilli: 1000, unitCostPaisa: 20000 }])),
      ).toThrow("audit down");

      expectUntouched(order);
    });
  });

  describe("no edit path", () => {
    it("exposes only post and the reads", () => {
      expect(Object.keys(service)).toEqual(["post", "list", "get", "lastCost", "lowMargin"]);
      expect(
        Object.values(ipcChannels).filter((name) => name.startsWith("goods-received:")),
      ).toEqual([
        "goods-received:post",
        "goods-received:list",
        "goods-received:get",
        "goods-received:last-cost",
        "goods-received:low-margin",
      ]);
    });

    it("leaves the order not editable after posting", () => {
      const order = confirmedOrder();
      posted(fromOrder(order, [{ index: 0, qtyMilli: 1000, unitCostPaisa: 14000 }]));

      const result = orders.update(
        updatePurchaseOrderInputSchema.parse({
          id: order.id,
          supplierId,
          notes: null,
          lines: [{ productId: sugarId, orderedQtyMilli: 9000, unitCostPaisa: 1 }],
        }),
      );

      expect(result).toMatchObject({ ok: false, reason: "not-editable" });
    });
  });

  describe("remaining after a partial delivery", () => {
    it("shows what is left and finishes at received", () => {
      const order = confirmedOrder([
        { productId: teaId, orderedQtyMilli: 24000, unitCostPaisa: 500 },
      ]);
      posted(fromOrder(order, [{ index: 0, qtyMilli: 6000, unitCostPaisa: 500 }]));
      expect(orderNow(order.id)).toMatchObject({
        status: "partly_received",
        lines: [{ remainingQtyMilli: 18000 }],
      });

      posted(fromOrder(order, [{ index: 0, qtyMilli: 18000, unitCostPaisa: 500 }]));
      expect(orderNow(order.id)).toMatchObject({
        status: "received",
        lines: [{ remainingQtyMilli: 0 }],
      });
    });
  });

  describe("list", () => {
    it("lists newest first with line counts and the order number", () => {
      const order = confirmedOrder();
      const first = posted(direct([lineOf(sugarId), lineOf(teaId)]));
      const second = posted(fromOrder(order, [{ index: 0, qtyMilli: 1000, unitCostPaisa: 14000 }]));

      const result = listAll();

      expect(result.total).toBe(2);
      expect(result.items.map((item) => item.id)).toEqual([second.id, first.id]);
      expect(result.items[0]).toMatchObject({
        orderNo: order.orderNo,
        purchaseOrderId: order.id,
        lineCount: 1,
        supplierName: "Al-Noor",
        supplierInvoiceNo: "INV-2",
      });
      expect(result.items[1]).toMatchObject({ orderNo: null, purchaseOrderId: null, lineCount: 2 });
    });

    it("filters by supplier", () => {
      posted(direct([lineOf(sugarId)]));
      const other = database.db
        .insert(suppliers)
        .values({ storeId: storeId(), name: "Other" })
        .returning()
        .get().id;
      const note = posted(direct([lineOf(sugarId)], { supplierId: other }));

      const result = listAll({ supplierId: other });

      expect(result.total).toBe(1);
      expect(result.items.map((item) => item.id)).toEqual([note.id]);
    });

    it("includes both edge days and excludes a note just outside", () => {
      at("2024-03-09T23:59:00");
      const before = posted(direct([lineOf(sugarId)]));
      at("2024-03-10T00:00:30");
      const startEdge = posted(direct([lineOf(sugarId)]));
      at("2024-03-12T23:59:00");
      const endEdge = posted(direct([lineOf(sugarId)]));
      at("2024-03-13T00:00:30");
      const after = posted(direct([lineOf(sugarId)]));

      const ids = listAll({ from: "2024-03-10", to: "2024-03-12" }).items.map((item) => item.id);

      expect(ids).toEqual([endEdge.id, startEdge.id]);
      expect(ids).not.toContain(before.id);
      expect(ids).not.toContain(after.id);
      expect(listAll({ from: "2024-03-13" }).items.map((item) => item.id)).toEqual([after.id]);
      expect(listAll({ from: "2024-03-12", to: "2024-03-10" }).items).toEqual([]);
    });

    it("pages and reports the full total", () => {
      const ids = Array.from(
        { length: 5 },
        () => posted(direct([lineOf(sugarId)])).id,
      ).toReversed();

      const page = listAll({ limit: 2, offset: 2 });

      expect(page.total).toBe(5);
      expect(page.items.map((item) => item.id)).toEqual(ids.slice(2, 4));
      expect(listAll({ limit: 2, offset: 4 }).items.map((item) => item.id)).toEqual(ids.slice(4));
    });

    it("lists nothing when empty", () => {
      expect(listAll()).toEqual({ items: [], total: 0 });
    });
  });

  describe("get", () => {
    it("returns the same note that post returned", () => {
      const order = confirmedOrder();
      const note = posted(fromOrder(order, [{ index: 0, qtyMilli: 1000, unitCostPaisa: 14000 }]));
      const direct1 = posted(direct([lineOf(sugarId), lineOf(teaId)]));

      expect(service.get({ id: note.id })).toEqual({ ok: true, note });
      expect(service.get({ id: direct1.id })).toEqual({ ok: true, note: direct1 });
      expect(note.orderNo).toBe(order.orderNo);
    });

    it("refuses an unknown note", () => {
      expect(service.get({ id: missingId })).toMatchObject({ ok: false, reason: "not-found" });
    });
  });

  describe("lastCost", () => {
    it("is null when the product was never received", () => {
      expect(service.lastCost({ productId: sugarId })).toEqual({ unitCostPaisa: null });
    });

    it("returns the newest note's cost, not the weighted average", () => {
      posted(direct([{ productId: teaId, qtyMilli: 10000, unitCostPaisa: 100 }]));
      posted(direct([{ productId: teaId, qtyMilli: 10000, unitCostPaisa: 300 }]));
      posted(direct([{ productId: sugarId, qtyMilli: 1000, unitCostPaisa: 999 }]));

      expect(costOf(teaId)).toBe(200);
      expect(service.lastCost({ productId: teaId })).toEqual({ unitCostPaisa: 300 });
    });

    it("takes the later position within one note", () => {
      posted(
        direct([
          { productId: teaId, qtyMilli: 1000, unitCostPaisa: 100 },
          { productId: teaId, qtyMilli: 1000, unitCostPaisa: 700 },
        ]),
      );

      expect(service.lastCost({ productId: teaId })).toEqual({ unitCostPaisa: 700 });
    });
  });

  describe("lowMargin", () => {
    it("returns no items while the threshold is unset", () => {
      const free = priced("Free", 0);
      const note = receiveAt(free, 100);

      expect(service.lowMargin({ id: note.id })).toEqual({
        ok: true,
        thresholdBps: null,
        items: [],
      });
    });

    it("lists a below-threshold product in a tax-exclusive store with its new average cost", () => {
      setStore({ pricesIncludeTax: false, marginThresholdBps: 2000 });
      const low = priced("Low", 10000);
      const atThreshold = priced("At", 10000);
      const note = posted(
        direct([
          { productId: low, qtyMilli: 1000, unitCostPaisa: 8001 },
          { productId: atThreshold, qtyMilli: 1000, unitCostPaisa: 8000 },
        ]),
      );

      const result = lowMargin(note.id);

      expect(result.thresholdBps).toBe(2000);
      expect(result.items).toEqual([
        {
          productId: low,
          nameEn: "Low",
          nameUr: null,
          unit: "piece",
          costPaisa: 8001,
          salePricePaisa: 10000,
          mrpPaisa: null,
          marginBps: 1999,
        },
      ]);
    });

    it("extracts tax in a tax-inclusive store before comparing", () => {
      setStore({ pricesIncludeTax: true, standardTaxRateBps: 1800, marginThresholdBps: 2000 });
      const low = priced("Low", 11800);
      const atThreshold = priced("At", 11800);
      const note = posted(
        direct([
          { productId: low, qtyMilli: 1000, unitCostPaisa: 8001 },
          { productId: atThreshold, qtyMilli: 1000, unitCostPaisa: 8000 },
        ]),
      );

      expect(lowMargin(note.id).items.map((item) => item.productId)).toEqual([low]);
    });

    it("uses the store rate when the tax category has none", () => {
      setStore({ pricesIncludeTax: true, standardTaxRateBps: 1000, marginThresholdBps: 2000 });
      const product = priced("Rate", 11000);
      const note = receiveAt(product, 8001);

      expect(lowMargin(note.id).items).toHaveLength(1);
      setStore({ standardTaxRateBps: 0 });
      expect(lowMargin(note.id).items).toHaveLength(0);
    });

    it("lists only products on that note", () => {
      setStore({ pricesIncludeTax: false, marginThresholdBps: 2000 });
      const onNote = priced("On note", 10000);
      priced("Other", 10000, { costPaisa: 9500 });
      const note = receiveAt(onNote, 9000);

      expect(lowMargin(note.id).items.map((item) => item.productId)).toEqual([onNote]);
    });

    it("lists a zero price with a null margin", () => {
      setStore({ marginThresholdBps: 2000 });
      const free = priced("Free", 0);
      const note = receiveAt(free, 100);

      expect(lowMargin(note.id).items).toMatchObject([{ productId: free, marginBps: null }]);
    });

    it("lists a product on two lines once, in line order", () => {
      setStore({ pricesIncludeTax: false, marginThresholdBps: 2000 });
      const first = priced("First", 10000);
      const second = priced("Second", 10000);
      const note = posted(
        direct([
          { productId: second, qtyMilli: 1000, unitCostPaisa: 9000 },
          { productId: first, qtyMilli: 1000, unitCostPaisa: 9000 },
          { productId: second, qtyMilli: 1000, unitCostPaisa: 9000 },
        ]),
      );

      expect(lowMargin(note.id).items.map((item) => item.productId)).toEqual([second, first]);
    });

    it("leaves out deleted products", () => {
      setStore({ pricesIncludeTax: false, marginThresholdBps: 2000 });
      const gone = priced("Gone", 10000);
      const note = receiveAt(gone, 9000);
      database.db
        .update(products)
        .set({ deletedAt: new Date() })
        .where(eq(products.id, gone))
        .run();

      expect(lowMargin(note.id).items).toEqual([]);
    });

    it("refuses an unknown note and another store's note", () => {
      setStore({ marginThresholdBps: 2000 });
      expect(service.lowMargin({ id: missingId })).toMatchObject({
        ok: false,
        reason: "not-found",
      });
      const note = receiveAt(sugarId, 100);
      const otherStore = database.db.insert(stores).values({}).returning().get().id;
      database.db
        .update(goodsReceivedNotes)
        .set({ storeId: otherStore })
        .where(eq(goodsReceivedNotes.id, note.id))
        .run();

      expect(service.lowMargin({ id: note.id })).toMatchObject({ ok: false, reason: "not-found" });
    });

    it("throws when signed out", () => {
      sessions.end();
      expect(() => service.lowMargin({ id: missingId })).toThrow(UnauthenticatedError);
    });

    it("changes nothing by itself", () => {
      setStore({ pricesIncludeTax: false, marginThresholdBps: 2000 });
      const low = priced("Low", 10000);
      const note = receiveAt(low, 9000);
      const before = database.db.select().from(products).all();
      const priceAudits = auditRows("price_change").length;

      lowMargin(note.id);

      expect(database.db.select().from(products).all()).toEqual(before);
      expect(auditRows("price_change")).toHaveLength(priceAudits);
    });

    it("accepting a new price writes one price_change, no cost_change, and keeps barcodes", () => {
      setStore({ pricesIncludeTax: false, marginThresholdBps: 2000 });
      const productsService = createProductsService({ database, audit, sessions });
      const category = database.db.select().from(categories).get()!;
      const tax = database.db.select().from(taxCategories).get()!;
      const created = productsService.create({
        nameEn: "Tapal",
        nameUr: null,
        categoryId: category.id,
        taxCategoryId: tax.id,
        brand: null,
        unit: "piece",
        internalCode: null,
        costPaisa: 0,
        salePricePaisa: 10000,
        mrpPaisa: 13000,
        pctCode: null,
        lowStockThresholdMilli: null,
        barcodes: [
          { barcode: "8964000000011", packQtyMilli: 1000, salePricePaisa: null },
          { barcode: "8964000000012", packQtyMilli: 12000, salePricePaisa: 110000 },
        ],
      });
      if (!created.ok) throw new Error(created.message);
      const note = receiveAt(created.product.id, 9000);
      const costChanges = auditRows("cost_change").length;
      const fresh = productsService.get({ id: created.product.id });
      if (!fresh.ok) throw new Error(fresh.message);

      const input = priceUpdateInput(fresh.product, 12000);
      const result = productsService.update(updateProductInputSchema.parse(input));

      expect(result.ok).toBe(true);
      const changes = auditRows("price_change");
      expect(changes).toHaveLength(1);
      expect(JSON.parse(changes[0]!.details!)).toMatchObject({ oldPaisa: 10000, newPaisa: 12000 });
      expect(auditRows("cost_change")).toHaveLength(costChanges);
      const after = productsService.get({ id: created.product.id });
      if (!after.ok) throw new Error(after.message);
      expect(after.product.barcodes).toEqual(fresh.product.barcodes);
      expect(after.product.costPaisa).toBe(9000);
      expect(lowMargin(note.id).items).toHaveLength(0);
    });
  });

  it("throws when a read is called signed out", () => {
    sessions.end();
    expect(() => service.list({ limit: 10, offset: 0 })).toThrow(UnauthenticatedError);
    expect(() => service.get({ id: missingId })).toThrow(UnauthenticatedError);
    expect(() => service.lastCost({ productId: sugarId })).toThrow(UnauthenticatedError);
  });

  it("throws when signed out and writes nothing", () => {
    sessions.end();
    expect(() =>
      service.post(direct([{ productId: sugarId, qtyMilli: 1, unitCostPaisa: 1 }])),
    ).toThrow(UnauthenticatedError);
    expectNothingWritten();
  });
});
