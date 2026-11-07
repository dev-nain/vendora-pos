import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postGoodsReceivedInputSchema } from "../../shared/goods-received";
import {
  postPurchaseReturnInputSchema,
  type PostPurchaseReturnInput,
  type PostPurchaseReturnResult,
} from "../../shared/purchase-returns";
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
  purchaseReturnLines,
  purchaseReturns,
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
import { createPurchaseReturnsService } from "./purchase-returns";
import { createStockService, type StockService } from "./stock";

const missingId = "01900000-0000-7000-8000-000000000001";

const fromNoteInput = (
  noteId: string,
  lines: { goodsReceivedLineId: string; qtyMilli: number }[],
  overrides: Record<string, unknown> = {},
) =>
  postPurchaseReturnInputSchema.parse({
    kind: "note",
    goodsReceivedNoteId: noteId,
    reason: "expired",
    notes: null,
    lines,
    ...overrides,
  });

describe("createPurchaseReturnsService", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let audit: ReturnType<typeof createAuditService>;
  let stock: StockService;
  let grn: ReturnType<typeof createGoodsReceivedService>;
  let service: ReturnType<typeof createPurchaseReturnsService>;
  let clock: number;
  let supplierId: string;
  let otherSupplierId: string;
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
  const returnRows = () => database.db.select().from(purchaseReturns).all();
  const returnLineRows = () => database.db.select().from(purchaseReturnLines).all();
  const movementRows = (type?: string) =>
    database.db
      .select()
      .from(stockMovements)
      .all()
      .filter((row) => !type || row.type === type);
  const costOf = (id: string) =>
    database.db.select().from(products).where(eq(products.id, id)).get()!.costPaisa;
  const onHand = (id: string) =>
    movementRows()
      .filter((row) => row.productId === id)
      .reduce((sum, row) => sum + row.qtyMilli, 0);

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

  const receive = (
    productId: string,
    qtyMilli: number,
    unitCostPaisa: number,
    from: string = supplierId,
  ) => {
    const result = grn.post(
      postGoodsReceivedInputSchema.parse({
        kind: "direct",
        supplierId: from,
        supplierInvoiceNo: "INV-1",
        lines: [{ productId, qtyMilli, unitCostPaisa }],
      }),
    );
    if (!result.ok) throw new Error(`receive failed: ${result.reason}`);
    return result.note;
  };

  const fromSupplier = (
    lines: { productId: string; qtyMilli: number }[],
    overrides: Record<string, unknown> = {},
  ) =>
    postPurchaseReturnInputSchema.parse({
      kind: "supplier",
      supplierId,
      reason: "damaged",
      notes: null,
      lines,
      ...overrides,
    });

  const posted = (input: PostPurchaseReturnInput) => {
    const result = service.post(postPurchaseReturnInputSchema.parse(input));
    if (!result.ok) throw new Error(`post failed: ${result.reason}`);
    return result.purchaseReturn;
  };

  const expectRefused = (result: PostPurchaseReturnResult, reason: string) => {
    expect(result).toMatchObject({ ok: false, reason });
    expect(returnRows()).toHaveLength(0);
    expect(returnLineRows()).toHaveLength(0);
    expect(movementRows("purchase_return")).toHaveLength(0);
    expect(auditRows("purchase_return_post")).toHaveLength(0);
  };

  const build = (stockService: Pick<StockService, "record">) =>
    createPurchaseReturnsService({
      database,
      audit,
      sessions,
      stock: stockService,
      now: () => new Date((clock += 1000)),
    });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-purchase-returns-"));
    database = openMigratedDatabase(join(dir, "vendora.db"));
    seedStoreAndTerminal(database);
    sessions = createSessionStore();
    clock = 1_700_000_000_000;
    audit = createAuditService(database);
    stock = createStockService({ database, audit });
    grn = createGoodsReceivedService({
      database,
      audit,
      sessions,
      stock,
      now: () => new Date((clock += 1000)),
    });
    service = build(stock);
    supplierId = database.db
      .insert(suppliers)
      .values({ storeId: storeId(), name: "Al-Noor" })
      .returning()
      .get().id;
    otherSupplierId = database.db
      .insert(suppliers)
      .values({ storeId: storeId(), name: "Rehman Traders" })
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

  describe("stock", () => {
    it("takes stock out through one purchase return movement", () => {
      receive(teaId, 24000, 10000);

      const result = posted(fromSupplier([{ productId: teaId, qtyMilli: 6000 }]));

      expect(onHand(teaId)).toBe(18000);
      const movements = movementRows("purchase_return");
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        productId: teaId,
        qtyMilli: -6000,
        sourceType: "purchase_return_line",
        sourceId: result.lines[0]!.id,
        reason: null,
        actorUserId: userId,
      });
    });

    it("leaves the average cost unchanged and books the average on the movement", () => {
      receive(teaId, 10000, 10000);
      receive(teaId, 10000, 12000);
      expect(costOf(teaId)).toBe(11000);
      const costChanges = auditRows("cost_change").length;

      const result = posted(fromSupplier([{ productId: teaId, qtyMilli: 5000 }]));

      expect(costOf(teaId)).toBe(11000);
      expect(movementRows("purchase_return")[0]!.unitCostPaisa).toBe(11000);
      expect(result.lines[0]!.unitCostPaisa).toBe(12000);
      expect(auditRows("cost_change")).toHaveLength(costChanges);
    });

    it("posts a return that takes stock below zero", () => {
      receive(teaId, 2000, 10000);
      database.db.delete(stockMovements).where(eq(stockMovements.type, "receipt")).run();
      expect(onHand(teaId)).toBe(0);

      posted(fromSupplier([{ productId: teaId, qtyMilli: 2000 }]));

      expect(onHand(teaId)).toBe(-2000);
    });

    it("rolls everything back when a later line fails", () => {
      receive(teaId, 10000, 10000);
      receive(sugarId, 10000, 10000);
      let calls = 0;
      const failing = build({
        record: (tx, input) => {
          calls += 1;
          if (calls === 2) throw new Error("stock failed");
          return stock.record(tx, input);
        },
      });

      expect(() =>
        failing.post(
          fromSupplier([
            { productId: teaId, qtyMilli: 1000 },
            { productId: sugarId, qtyMilli: 1000 },
          ]),
        ),
      ).toThrow("stock failed");

      expect(returnRows()).toHaveLength(0);
      expect(returnLineRows()).toHaveLength(0);
      expect(movementRows("purchase_return")).toHaveLength(0);
      expect(auditRows("purchase_return_post")).toHaveLength(0);
      expect(posted(fromSupplier([{ productId: teaId, qtyMilli: 1000 }])).returnNo).toBe(
        "PRN-T1-000001",
      );
    });
  });

  describe("supplier source", () => {
    it("takes the cost from the newest receipt from that supplier", () => {
      receive(teaId, 10000, 10000);
      receive(teaId, 10000, 10500);
      receive(teaId, 10000, 9000, otherSupplierId);

      const result = posted(fromSupplier([{ productId: teaId, qtyMilli: 1000 }]));

      expect(result.lines[0]!.unitCostPaisa).toBe(10500);
      expect(result).toMatchObject({
        supplierId,
        supplierName: "Al-Noor",
        goodsReceivedNoteId: null,
        grnNo: null,
        reason: "damaged",
        actorName: "Cashier",
        totalPaisa: 10500,
      });
    });

    it("refuses a product only received from another supplier", () => {
      receive(teaId, 10000, 10000, otherSupplierId);
      expectRefused(
        service.post(fromSupplier([{ productId: teaId, qtyMilli: 1000 }])),
        "not-received",
      );
    });

    it("caps at received minus returned, counting linked returns", () => {
      const note = receive(teaId, 10000, 10000);
      posted(fromNoteInput(note.id, [{ goodsReceivedLineId: note.lines[0]!.id, qtyMilli: 4000 }]));
      posted(fromSupplier([{ productId: teaId, qtyMilli: 6000 }]));

      const over = service.post(fromSupplier([{ productId: teaId, qtyMilli: 1000 }]));

      expect(over).toMatchObject({ ok: false, reason: "over-returnable" });
      expect(returnRows()).toHaveLength(2);
    });

    it("refuses one milli-unit above what is left", () => {
      receive(sugarId, 5000, 10000);
      expect(service.post(fromSupplier([{ productId: sugarId, qtyMilli: 5001 }]))).toMatchObject({
        ok: false,
        reason: "over-returnable",
      });
      expect(service.post(fromSupplier([{ productId: sugarId, qtyMilli: 5000 }])).ok).toBe(true);
    });
  });

  describe("note source", () => {
    it("takes the cost from the note line and links the note", () => {
      receive(teaId, 10000, 9000);
      const note = receive(teaId, 10000, 10000);

      const result = posted(
        fromNoteInput(note.id, [{ goodsReceivedLineId: note.lines[0]!.id, qtyMilli: 2000 }]),
      );

      expect(result).toMatchObject({
        goodsReceivedNoteId: note.id,
        grnNo: note.grnNo,
        supplierInvoiceNo: "INV-1",
        supplierId,
      });
      expect(result.lines[0]).toMatchObject({
        goodsReceivedLineId: note.lines[0]!.id,
        unitCostPaisa: 10000,
      });
    });

    it("caps each line net of earlier returns on that line", () => {
      receive(teaId, 10000, 10000);
      const note = receive(teaId, 10000, 10000);
      const lineId = note.lines[0]!.id;
      posted(fromNoteInput(note.id, [{ goodsReceivedLineId: lineId, qtyMilli: 8000 }]));

      expect(
        service.post(fromNoteInput(note.id, [{ goodsReceivedLineId: lineId, qtyMilli: 3000 }])),
      ).toMatchObject({ ok: false, reason: "over-returnable" });
      expect(
        service.post(fromNoteInput(note.id, [{ goodsReceivedLineId: lineId, qtyMilli: 2000 }])).ok,
      ).toBe(true);
    });

    it("still holds the supplier cap after an unlinked return", () => {
      const note = receive(teaId, 10000, 10000);
      posted(fromSupplier([{ productId: teaId, qtyMilli: 9000 }]));

      expect(
        service.post(
          fromNoteInput(note.id, [{ goodsReceivedLineId: note.lines[0]!.id, qtyMilli: 2000 }]),
        ),
      ).toMatchObject({ ok: false, reason: "over-returnable" });
    });

    it("refuses a line from another note and an unknown note", () => {
      const note = receive(teaId, 10000, 10000);
      const other = receive(sugarId, 10000, 10000);

      expectRefused(
        service.post(
          fromNoteInput(note.id, [{ goodsReceivedLineId: other.lines[0]!.id, qtyMilli: 1000 }]),
        ),
        "line-unavailable",
      );
      expectRefused(
        service.post(fromNoteInput(missingId, [{ goodsReceivedLineId: missingId, qtyMilli: 1 }])),
        "note-not-found",
      );
    });

    it("leaves the note, its lines and a linked order untouched", () => {
      const note = receive(teaId, 10000, 10000);
      const notesBefore = database.db.select().from(goodsReceivedNotes).all();
      const linesBefore = database.db.select().from(goodsReceivedLines).all();
      const orderLinesBefore = database.db.select().from(purchaseOrderLines).all();

      posted(fromNoteInput(note.id, [{ goodsReceivedLineId: note.lines[0]!.id, qtyMilli: 2000 }]));

      expect(database.db.select().from(goodsReceivedNotes).all()).toEqual(notesBefore);
      expect(database.db.select().from(goodsReceivedLines).all()).toEqual(linesBefore);
      expect(database.db.select().from(purchaseOrderLines).all()).toEqual(orderLinesBefore);
    });
  });

  describe("validation", () => {
    it("refuses fractional pieces", () => {
      receive(teaId, 10000, 10000);
      expectRefused(
        service.post(fromSupplier([{ productId: teaId, qtyMilli: 1500 }])),
        "whole-units",
      );
    });

    it("refuses a deleted product but returns an archived one", () => {
      receive(teaId, 10000, 10000);
      receive(sugarId, 10000, 10000);
      database.db.update(products).set({ isActive: false }).where(eq(products.id, sugarId)).run();
      expect(service.post(fromSupplier([{ productId: sugarId, qtyMilli: 1000 }])).ok).toBe(true);

      database.db
        .update(products)
        .set({ deletedAt: new Date() })
        .where(eq(products.id, teaId))
        .run();
      expect(service.post(fromSupplier([{ productId: teaId, qtyMilli: 1000 }]))).toMatchObject({
        ok: false,
        reason: "product-unavailable",
      });
    });

    it("refuses an archived supplier", () => {
      receive(teaId, 10000, 10000);
      database.db
        .update(suppliers)
        .set({ deletedAt: new Date() })
        .where(eq(suppliers.id, supplierId))
        .run();
      expectRefused(
        service.post(fromSupplier([{ productId: teaId, qtyMilli: 1000 }])),
        "supplier-unavailable",
      );
    });
  });

  describe("totals and audit", () => {
    it("rounds a kg line half-up and sums the lines", () => {
      receive(sugarId, 10000, 333);
      receive(teaId, 10000, 250);

      const result = posted(
        fromSupplier([
          { productId: sugarId, qtyMilli: 1500 },
          { productId: teaId, qtyMilli: 3000 },
        ]),
      );

      expect(result.lines.map((line) => line.lineTotalPaisa)).toEqual([500, 750]);
      expect(result.totalPaisa).toBe(1250);
    });

    it("writes one audit row with the actor and no notes", () => {
      receive(teaId, 10000, 10000);
      const result = posted(
        fromSupplier([{ productId: teaId, qtyMilli: 2000 }], { notes: "Boxes crushed" }),
      );

      const [row] = auditRows("purchase_return_post");
      expect(auditRows("purchase_return_post")).toHaveLength(1);
      expect(row).toMatchObject({
        actorUserId: userId,
        entityType: "purchase_return",
        entityId: result.id,
      });
      expect(JSON.parse(row!.details as string)).toEqual({
        returnNo: "PRN-T1-000001",
        supplierId,
        goodsReceivedNoteId: null,
        reason: "damaged",
        totalPaisa: 20000,
        lineCount: 1,
      });
      expect(JSON.stringify(row!.details)).not.toContain("crushed");
      expect(result.notes).toBe("Boxes crushed");
    });
  });

  describe("returnable", () => {
    it("reports the last cost from the supplier and what is left", () => {
      receive(teaId, 10000, 10000);
      receive(teaId, 10000, 10500);
      posted(fromSupplier([{ productId: teaId, qtyMilli: 4000 }]));

      expect(service.returnable({ supplierId, productId: teaId })).toEqual({
        ok: true,
        product: { id: teaId, nameEn: "Tea box", nameUr: null, unit: "piece" },
        unitCostPaisa: 10500,
        returnableQtyMilli: 16000,
      });
    });

    it("refuses a product never received, an unknown product and an archived supplier", () => {
      expect(service.returnable({ supplierId, productId: teaId })).toMatchObject({
        reason: "not-received",
      });
      expect(service.returnable({ supplierId, productId: missingId })).toMatchObject({
        reason: "product-unavailable",
      });
      database.db
        .update(suppliers)
        .set({ deletedAt: new Date() })
        .where(eq(suppliers.id, supplierId))
        .run();
      expect(service.returnable({ supplierId, productId: teaId })).toMatchObject({
        reason: "supplier-unavailable",
      });
    });
  });

  describe("fromNote", () => {
    it("lists the lines with what is left to return", () => {
      const note = receive(teaId, 10000, 10000);
      posted(fromNoteInput(note.id, [{ goodsReceivedLineId: note.lines[0]!.id, qtyMilli: 3000 }]));
      posted(fromSupplier([{ productId: teaId, qtyMilli: 5000 }]));

      const result = service.fromNote({ id: note.id });

      expect(result).toMatchObject({
        ok: true,
        note: {
          id: note.id,
          grnNo: note.grnNo,
          supplierName: "Al-Noor",
          supplierInvoiceNo: "INV-1",
        },
        lines: [
          {
            goodsReceivedLineId: note.lines[0]!.id,
            receivedQtyMilli: 10000,
            unitCostPaisa: 10000,
            returnableQtyMilli: 2000,
          },
        ],
      });
    });

    it("keeps a fully returned line at zero and refuses an unknown note", () => {
      const note = receive(teaId, 2000, 10000);
      posted(fromSupplier([{ productId: teaId, qtyMilli: 2000 }]));

      expect(service.fromNote({ id: note.id })).toMatchObject({
        lines: [{ returnableQtyMilli: 0 }],
      });
      expect(service.fromNote({ id: missingId })).toMatchObject({
        ok: false,
        reason: "not-found",
      });
    });
  });

  describe("list and get", () => {
    it("lists newest first with the note number, line count, paging and total", () => {
      const note = receive(teaId, 10000, 10000);
      receive(sugarId, 10000, 10000);
      const first = posted(
        fromNoteInput(note.id, [{ goodsReceivedLineId: note.lines[0]!.id, qtyMilli: 1000 }]),
      );
      const second = posted(
        fromSupplier([
          { productId: teaId, qtyMilli: 1000 },
          { productId: sugarId, qtyMilli: 1000 },
        ]),
      );

      const page = service.list({ limit: 1, offset: 0 });
      expect(page.total).toBe(2);
      expect(page.items).toEqual([
        {
          id: second.id,
          returnNo: "PRN-T1-000002",
          supplierId,
          supplierName: "Al-Noor",
          grnNo: null,
          reason: "damaged",
          lineCount: 2,
          totalPaisa: 20000,
          createdAt: second.createdAt,
        },
      ]);
      expect(service.list({ limit: 1, offset: 1 }).items[0]).toMatchObject({
        id: first.id,
        grnNo: note.grnNo,
        lineCount: 1,
      });
      expect(service.list({ limit: 10, offset: 5 }).items).toEqual([]);
    });

    it("gets what post returned and refuses an unknown return", () => {
      receive(teaId, 10000, 10000);
      const result = posted(fromSupplier([{ productId: teaId, qtyMilli: 1000 }]));

      expect(service.get({ id: result.id })).toEqual({ ok: true, purchaseReturn: result });
      expect(service.get({ id: missingId })).toMatchObject({ ok: false, reason: "not-found" });
    });
  });

  it("offers no way to edit a posted return", () => {
    expect(Object.keys(service).toSorted()).toEqual([
      "fromNote",
      "get",
      "list",
      "post",
      "returnable",
    ]);
  });

  it("throws when signed out", () => {
    sessions.end();
    expect(() => service.post(fromSupplier([{ productId: teaId, qtyMilli: 1000 }]))).toThrow(
      UnauthenticatedError,
    );
    expect(() => service.returnable({ supplierId, productId: teaId })).toThrow(
      UnauthenticatedError,
    );
    expect(() => service.fromNote({ id: missingId })).toThrow(UnauthenticatedError);
    expect(() => service.list({ limit: 10, offset: 0 })).toThrow(UnauthenticatedError);
    expect(() => service.get({ id: missingId })).toThrow(UnauthenticatedError);
  });
});
