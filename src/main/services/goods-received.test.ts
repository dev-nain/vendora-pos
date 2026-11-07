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
      expect(Object.keys(service)).toEqual(["post", "list", "get"]);
      expect(
        Object.values(ipcChannels).filter((name) => name.startsWith("goods-received:")),
      ).toEqual(["goods-received:post"]);
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

  it("throws when a read is called signed out", () => {
    sessions.end();
    expect(() => service.list({ limit: 10, offset: 0 })).toThrow(UnauthenticatedError);
    expect(() => service.get({ id: missingId })).toThrow(UnauthenticatedError);
  });

  it("throws when signed out and writes nothing", () => {
    sessions.end();
    expect(() =>
      service.post(direct([{ productId: sugarId, qtyMilli: 1, unitCostPaisa: 1 }])),
    ).toThrow(UnauthenticatedError);
    expectNothingWritten();
  });
});
