import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ipcErrorMessages } from "@shared/ipc";
import { createProductInputSchema } from "@shared/products";
import { createSessionStore, type SessionStore } from "./auth/session";
import type { VendoraDatabase } from "./db/client";
import { auditLog, categories, products, stores, taxCategories, users } from "./db/schema";
import { seedStoreAndTerminal } from "./db/seed";
import { registerIpcHandlers } from "./ipc";
import { createAuditService } from "./services/audit";
import { createCatalogExportService } from "./services/catalog-export";
import { createInventoryService, type InventoryService } from "./services/inventory";
import { createProductsService, type ProductsService } from "./services/products";
import { createCheckoutKit, type CheckoutKit } from "./services/checkout-test-kit";
import { createSalesService, type SalesService } from "./services/sales";
import {
  createPurchaseOrderDocumentsService,
  type PurchaseOrderDocumentsService,
} from "./services/purchase-order-documents";
import {
  createPurchaseOrdersService,
  type PurchaseOrdersService,
} from "./services/purchase-orders";
import { createShiftsService, type ShiftsService } from "./services/shifts";
import { createSuppliersService, type SuppliersService } from "./services/suppliers";
import { createGoodsReceivedService, type GoodsReceivedService } from "./services/goods-received";
import {
  createPurchaseHistoryService,
  type PurchaseHistoryService,
} from "./services/purchase-history";
import {
  createPurchaseReturnsService,
  type PurchaseReturnsService,
} from "./services/purchase-returns";
import {
  createPurchaseReturnDocumentsService,
  type PurchaseReturnDocumentsService,
} from "./services/purchase-return-documents";
import { createStockService } from "./services/stock";
import { openMigratedDatabase } from "./db/test-database";

const handlers = vi.hoisted(
  () => new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
);

vi.mock("electron", () => ({
  app: { getVersion: () => "0.0.0" },
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    },
    on: () => undefined,
  },
}));

const invoke = async (channel: string, input?: unknown) => {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler({}, input);
};

const unknownId = "0192f3a0-0000-7000-8000-000000000099";

const order = (supplierId: string, productId: string) => ({
  supplierId,
  notes: null,
  lines: [{ productId, orderedQtyMilli: 2000, unitCostPaisa: 14333 }],
});

const directGrn = (supplierId: string, productId: string) => ({
  kind: "direct",
  supplierId,
  supplierInvoiceNo: "INV-100",
  lines: [{ productId, qtyMilli: 10000, unitCostPaisa: 12000 }],
});

describe("products ipc", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let service: ProductsService;
  let suppliersService: SuppliersService;
  let purchaseOrdersService: PurchaseOrdersService;
  let goodsReceivedService: GoodsReceivedService;
  let purchaseReturnsService: PurchaseReturnsService;
  let purchaseHistoryService: PurchaseHistoryService;
  let purchaseReturnDocumentsService: PurchaseReturnDocumentsService;
  let purchaseOrderDocumentsService: PurchaseOrderDocumentsService;
  const renderer = { toPdf: vi.fn(async () => Buffer.from("%PDF-")), print: vi.fn() };
  let exportPath: string | null;
  let categoryId: string;
  let taxCategoryId: string;

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
      loggedInAt: new Date(0),
    });
  };

  const draft = (patch: Record<string, unknown> = {}) => ({
    nameEn: "Tapal Danedar 950g",
    nameUr: null,
    categoryId,
    taxCategoryId,
    brand: null,
    unit: "piece",
    internalCode: null,
    costPaisa: 90000,
    salePricePaisa: 105000,
    mrpPaisa: null,
    pctCode: null,
    lowStockThresholdMilli: null,
    barcodes: [{ barcode: "B1", packQtyMilli: 1000, salePricePaisa: null }],
    ...patch,
  });

  const bulkPrice = { kind: "set-price", salePricePaisa: 500 } as const;

  const seedProduct = () => {
    signIn("manager");
    const result = service.create(createProductInputSchema.parse(draft()));
    if (!result.ok) throw new Error(result.message);
    return result.product;
  };

  const counts = () => ({
    products: database.db.select().from(products).all().length,
    audit: database.db.select().from(auditLog).all().length,
  });

  beforeEach(() => {
    handlers.clear();
    dir = mkdtempSync(join(tmpdir(), "vendora-ipc-"));
    database = openMigratedDatabase(join(dir, "vendora.db"));
    seedStoreAndTerminal(database);
    categoryId = database.db.select().from(categories).get()!.id;
    taxCategoryId = database.db.select().from(taxCategories).get()!.id;
    sessions = createSessionStore();
    service = createProductsService({ database, audit: createAuditService(database), sessions });
    suppliersService = createSuppliersService({
      database,
      audit: createAuditService(database),
      sessions,
    });
    purchaseOrdersService = createPurchaseOrdersService({
      database,
      audit: createAuditService(database),
      sessions,
    });
    goodsReceivedService = createGoodsReceivedService({
      database,
      audit: createAuditService(database),
      sessions,
      stock: createStockService({ database, audit: createAuditService(database) }),
    });
    purchaseReturnsService = createPurchaseReturnsService({
      database,
      audit: createAuditService(database),
      sessions,
      stock: createStockService({ database, audit: createAuditService(database) }),
    });
    purchaseHistoryService = createPurchaseHistoryService({ database, sessions });
    purchaseReturnDocumentsService = createPurchaseReturnDocumentsService({
      database,
      sessions,
      purchaseReturns: purchaseReturnsService,
      renderer,
      chooseSavePath: async () => join(dir, "return.pdf"),
    });
    purchaseOrderDocumentsService = createPurchaseOrderDocumentsService({
      database,
      sessions,
      purchaseOrders: purchaseOrdersService,
      renderer,
      chooseSavePath: async () => join(dir, "order.pdf"),
    });
    exportPath = join(dir, "catalog.csv");
    const catalogExport = createCatalogExportService({
      database,
      sessions,
      chooseSavePath: async () => exportPath,
    });
    const stub = {} as never;
    registerIpcHandlers({
      auth: stub,
      billDrafts: stub,
      catalogExport,
      categories: stub,
      goodsReceived: goodsReceivedService,
      inventory: stub,
      products: service,
      purchaseHistory: purchaseHistoryService,
      purchaseOrderDocuments: purchaseOrderDocumentsService,
      purchaseOrders: purchaseOrdersService,
      purchaseReturnDocuments: purchaseReturnDocumentsService,
      purchaseReturns: purchaseReturnsService,
      receipts: stub,
      returns: stub,
      sales: stub,
      settings: stub,
      shifts: stub,
      suppliers: suppliersService,
      taxCategories: stub,
      users: stub,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("invalid input never reaches the service", () => {
    it.each([
      ["products:create", "create", draft({ costPaisa: 1.5 })],
      ["products:create", "create", draft({ nameEn: "" })],
      ["products:create", "create", { ...draft(), extra: 1 }],
      ["products:update", "update", { ...draft(), id: "x" }],
      ["products:archive", "archive", { id: "x" }],
      ["products:restore", "restore", { id: "x" }],
      ["products:delete", "delete", { id: "x" }],
      ["products:get", "get", {}],
      ["products:search", "search", { query: "", limit: 101, offset: 0 }],
      ["products:lookup-barcode", "lookupBarcode", { barcode: "" }],
      ["products:bulk-update", "bulkUpdate", { productIds: [], change: bulkPrice }],
      [
        "products:bulk-update",
        "bulkUpdate",
        { productIds: [unknownId], change: { kind: "adjust-price", bps: 0 } },
      ],
    ] as const)("%s rejects bad input", async (channel, method, input) => {
      signIn("owner");
      const spy = vi.spyOn(service, method);
      await expect(invoke(channel, input)).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("signed out", () => {
    it("is refused on every write and nothing changes", async () => {
      const product = seedProduct();
      sessions.end();
      const before = counts();
      const writes: [string, unknown][] = [
        ["products:create", draft({ barcodes: [] })],
        ["products:update", { ...draft(), id: product.id }],
        ["products:archive", { id: product.id }],
        ["products:restore", { id: product.id }],
        ["products:delete", { id: product.id }],
        ["products:bulk-update", { productIds: [product.id], change: bulkPrice }],
        ["products:export-csv", undefined],
      ];
      for (const [channel, input] of writes) {
        await expect(invoke(channel, input)).rejects.toThrow(
          new Error(ipcErrorMessages.unauthenticated),
        );
      }
      expect(counts()).toEqual(before);
    });

    it("can read, including cost and archived products", async () => {
      const product = seedProduct();
      signIn("cashier");
      expect(await invoke("products:lookup-barcode", { barcode: "B1" })).toMatchObject({
        source: "barcode",
        product: { costPaisa: 90000 },
      });

      signIn("manager");
      service.archive({ id: product.id });
      signIn("cashier");
      expect(await invoke("products:get", { id: product.id })).toMatchObject({
        ok: true,
        product: { costPaisa: 90000, isActive: false },
      });
      const found = (await invoke("products:search", {
        query: "tapal",
        includeArchived: true,
        limit: 10,
        offset: 0,
      })) as { items: { id: string }[] };
      expect(found.items.map((i) => i.id)).toEqual([product.id]);
    });
  });

  describe("suppliers", () => {
    const supplier = {
      name: "Al-Noor",
      contactPerson: null,
      phone: null,
      ntn: null,
      notes: null,
    };

    it.each([
      ["suppliers:create", "create", { ...supplier, name: "" }],
      ["suppliers:create", "create", { ...supplier, extra: 1 }],
      ["suppliers:update", "update", { ...supplier, id: "x" }],
      ["suppliers:archive", "archive", { id: "x" }],
      ["suppliers:restore", "restore", { id: "x" }],
      ["suppliers:list", "list", { includeArchived: "yes" }],
    ] as const)("%s rejects bad input", async (channel, method, input) => {
      signIn("owner");
      const spy = vi.spyOn(suppliersService, method);
      await expect(invoke(channel, input)).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
    });

    it("lists active suppliers when called with no input", async () => {
      signIn("cashier");
      const created = (await invoke("suppliers:create", supplier)) as {
        supplier: { id: string };
      };
      await invoke("suppliers:archive", { id: created.supplier.id });

      expect(await invoke("suppliers:list")).toEqual([]);
      expect(await invoke("suppliers:list", { includeArchived: true })).toHaveLength(1);
    });

    it("is refused when signed out", async () => {
      sessions.end();
      const writes: [string, unknown][] = [
        ["suppliers:list", undefined],
        ["suppliers:create", supplier],
        ["suppliers:update", { ...supplier, id: unknownId }],
        ["suppliers:archive", { id: unknownId }],
        ["suppliers:restore", { id: unknownId }],
      ];
      for (const [channel, input] of writes) {
        await expect(invoke(channel, input)).rejects.toThrow(
          new Error(ipcErrorMessages.unauthenticated),
        );
      }
    });
  });

  describe("goods received", () => {
    it.each([
      ["x", [{ productId: unknownId, qtyMilli: 1, unitCostPaisa: 1 }]],
      [unknownId, []],
    ] as const)("rejects bad input before the service runs", async (supplierId, lines) => {
      signIn("owner");
      const spy = vi.spyOn(goodsReceivedService, "post");
      await expect(
        invoke("goods-received:post", {
          kind: "direct",
          supplierId,
          supplierInvoiceNo: "INV-1",
          lines,
        }),
      ).rejects.toThrow();
      await expect(
        invoke("goods-received:post", { ...directGrn(unknownId, unknownId), extra: 1 }),
      ).rejects.toThrow();
      await expect(invoke("goods-received:post", { kind: "other" })).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
    });

    it("posts a direct note and moves the cost", async () => {
      signIn("cashier");
      const product = seedProduct();
      const created = (await invoke("suppliers:create", {
        name: "Al-Noor",
        contactPerson: null,
        phone: null,
        ntn: null,
        notes: null,
      })) as { supplier: { id: string } };

      const result = await invoke(
        "goods-received:post",
        directGrn(created.supplier.id, product.id),
      );

      expect(result).toMatchObject({
        ok: true,
        note: { grnNo: "GRN-T1-000001", totalPaisa: 120000, purchaseOrderId: null },
      });
      expect(
        database.db.select().from(products).where(eq(products.id, product.id)).get()!.costPaisa,
      ).toBe(12000);
    });

    it("is refused when signed out", async () => {
      sessions.end();
      await expect(invoke("goods-received:post", directGrn(unknownId, unknownId))).rejects.toThrow(
        new Error(ipcErrorMessages.unauthenticated),
      );
    });

    it.each([
      ["goods-received:list", "list", { limit: 0, offset: 0 }],
      ["goods-received:list", "list", { limit: 10, offset: 0, from: "soon" }],
      ["goods-received:list", "list", { limit: 10, offset: 0, extra: 1 }],
      ["goods-received:get", "get", { id: "x" }],
      ["goods-received:get", "get", { id: unknownId, extra: 1 }],
      ["goods-received:last-cost", "lastCost", { productId: "x" }],
      ["goods-received:last-cost", "lastCost", {}],
    ] as const)("rejects bad %s input before the service runs", async (channel, method, input) => {
      signIn("owner");
      const spy = vi.spyOn(goodsReceivedService, method);
      await expect(invoke(channel, input)).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
    });

    it.each([
      ["goods-received:list", { limit: 10, offset: 0 }],
      ["goods-received:get", { id: unknownId }],
      ["goods-received:last-cost", { productId: unknownId }],
    ] as const)("refuses %s when signed out", async (channel, input) => {
      sessions.end();
      await expect(invoke(channel, input)).rejects.toThrow(
        new Error(ipcErrorMessages.unauthenticated),
      );
    });

    it("reads a posted note back", async () => {
      signIn("cashier");
      const product = seedProduct();
      const created = (await invoke("suppliers:create", {
        name: "Al-Noor",
        contactPerson: null,
        phone: null,
        ntn: null,
        notes: null,
      })) as { supplier: { id: string } };
      const posted = (await invoke(
        "goods-received:post",
        directGrn(created.supplier.id, product.id),
      )) as { note: { id: string } };

      expect(await invoke("goods-received:list", { limit: 10, offset: 0 })).toMatchObject({
        total: 1,
        items: [{ id: posted.note.id, lineCount: 1 }],
      });
      expect(await invoke("goods-received:get", { id: posted.note.id })).toMatchObject({
        ok: true,
        note: { id: posted.note.id },
      });
      expect(await invoke("goods-received:last-cost", { productId: product.id })).toEqual({
        unitCostPaisa: 12000,
      });
    });
  });

  describe("purchase returns and history", () => {
    const line = { productId: unknownId, qtyMilli: 1000 };
    const supplierReturn = {
      kind: "supplier",
      supplierId: unknownId,
      reason: "damaged",
      notes: null,
      lines: [line],
    };

    it.each([
      ["purchase-returns:post", "post", { ...supplierReturn, supplierId: "x" }],
      ["purchase-returns:post", "post", { ...supplierReturn, reason: "lost" }],
      ["purchase-returns:post", "post", { ...supplierReturn, extra: 1 }],
      [
        "purchase-returns:post",
        "post",
        { ...supplierReturn, lines: [{ ...line, unitCostPaisa: 1 }] },
      ],
      ["purchase-returns:post", "post", { ...supplierReturn, lines: [line, line] }],
      ["purchase-returns:post", "post", { ...supplierReturn, lines: [] }],
      ["purchase-returns:post", "post", { kind: "other" }],
      ["purchase-returns:list", "list", { limit: 0, offset: 0 }],
      ["purchase-returns:list", "list", { limit: 10, offset: 0, extra: 1 }],
      ["purchase-returns:get", "get", { id: "x" }],
      ["purchase-returns:returnable", "returnable", { supplierId: unknownId, productId: "x" }],
      ["purchase-returns:from-note", "fromNote", { id: "x" }],
    ] as const)("%s rejects bad input before the service runs", async (channel, method, input) => {
      signIn("owner");
      const spy = vi.spyOn(purchaseReturnsService, method);
      await expect(invoke(channel, input)).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
    });

    it.each([
      ["purchase-returns:save-pdf", "savePdf", { id: "x" }],
      ["purchase-returns:save-pdf", "savePdf", { id: unknownId, extra: 1 }],
      ["purchase-returns:print", "print", { id: "x" }],
      ["purchase-returns:print", "print", {}],
    ] as const)("%s rejects bad input before the service runs", async (channel, method, input) => {
      signIn("owner");
      const spy = vi.spyOn(purchaseReturnDocumentsService, method);
      await expect(invoke(channel, input)).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
    });

    it.each([
      ["purchase-history:product", { productId: "x", limit: 10, offset: 0 }],
      ["purchase-history:product", { productId: unknownId, limit: 101, offset: 0 }],
      ["purchase-history:supplier", { supplierId: unknownId, limit: 10, offset: 0, extra: 1 }],
      ["purchase-history:supplier", { supplierId: "x", limit: 10, offset: 0 }],
    ] as const)("%s rejects bad input before the service runs", async (channel, input) => {
      signIn("owner");
      const spies = [
        vi.spyOn(purchaseHistoryService, "forProduct"),
        vi.spyOn(purchaseHistoryService, "forSupplier"),
      ];
      await expect(invoke(channel, input)).rejects.toThrow();
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    });

    it.each([
      ["purchase-returns:post", supplierReturn],
      ["purchase-returns:list", { limit: 10, offset: 0 }],
      ["purchase-returns:get", { id: unknownId }],
      ["purchase-returns:returnable", { supplierId: unknownId, productId: unknownId }],
      ["purchase-returns:from-note", { id: unknownId }],
      ["purchase-returns:save-pdf", { id: unknownId }],
      ["purchase-returns:print", { id: unknownId }],
      ["purchase-history:product", { productId: unknownId, limit: 10, offset: 0 }],
      ["purchase-history:supplier", { supplierId: unknownId, limit: 10, offset: 0 }],
    ] as const)("refuses %s when signed out", async (channel, input) => {
      sessions.end();
      await expect(invoke(channel, input)).rejects.toThrow(
        new Error(ipcErrorMessages.unauthenticated),
      );
    });

    it("returns and reads back a return through the handlers", async () => {
      signIn("cashier");
      const product = seedProduct();
      const created = (await invoke("suppliers:create", {
        name: "Al-Noor",
        contactPerson: null,
        phone: null,
        ntn: null,
        notes: null,
      })) as { supplier: { id: string } };
      await invoke("goods-received:post", directGrn(created.supplier.id, product.id));

      const posted = (await invoke("purchase-returns:post", {
        kind: "supplier",
        supplierId: created.supplier.id,
        reason: "expired",
        notes: null,
        lines: [{ productId: product.id, qtyMilli: 2000 }],
      })) as { ok: true; purchaseReturn: { id: string; returnNo: string } };

      expect(posted).toMatchObject({
        ok: true,
        purchaseReturn: { returnNo: "PRN-T1-000001", totalPaisa: 24000 },
      });
      expect(await invoke("purchase-returns:list", { limit: 10, offset: 0 })).toMatchObject({
        total: 1,
      });
      expect(await invoke("purchase-returns:get", { id: posted.purchaseReturn.id })).toMatchObject({
        ok: true,
      });
      expect(
        await invoke("purchase-history:product", { productId: product.id, limit: 10, offset: 0 }),
      ).toMatchObject({ ok: true, items: [{ kind: "return" }, { kind: "receipt" }] });
      expect(
        await invoke("purchase-history:supplier", {
          supplierId: created.supplier.id,
          limit: 10,
          offset: 0,
        }),
      ).toMatchObject({ ok: true, hasMore: false });
    });
  });

  describe("purchase orders", () => {
    it.each([
      ["purchase-orders:create", "create", { supplierId: "x", notes: null, lines: [] }],
      ["purchase-orders:create", "create", { supplierId: unknownId, notes: null, lines: [] }],
      ["purchase-orders:create", "create", { supplierId: unknownId, notes: null, extra: 1 }],
      ["purchase-orders:update", "update", { id: "x", supplierId: unknownId, notes: null }],
      ["purchase-orders:get", "get", { id: "x" }],
      ["purchase-orders:confirm", "confirm", { id: "x" }],
      ["purchase-orders:cancel", "cancel", { id: "x" }],
    ] as const)("%s rejects bad input", async (channel, method, input) => {
      signIn("owner");
      const spy = vi.spyOn(purchaseOrdersService, method);
      await expect(invoke(channel, input)).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
    });

    it("creates, confirms and reads an order", async () => {
      signIn("cashier");
      const product = seedProduct();
      const created = (await invoke("suppliers:create", {
        name: "Al-Noor",
        contactPerson: null,
        phone: null,
        ntn: null,
        notes: null,
      })) as { supplier: { id: string } };

      const result = (await invoke(
        "purchase-orders:create",
        order(created.supplier.id, product.id),
      )) as { ok: true; order: { id: string; status: string; totalPaisa: number } };
      expect(result).toMatchObject({ ok: true, order: { status: "draft", totalPaisa: 28666 } });

      await invoke("purchase-orders:confirm", { id: result.order.id });
      expect(await invoke("purchase-orders:get", { id: result.order.id })).toMatchObject({
        ok: true,
        order: { status: "confirmed" },
      });
      expect(await invoke("purchase-orders:list")).toHaveLength(1);
    });

    it.each([
      ["purchase-orders:save-pdf", "savePdf", { id: "x" }],
      ["purchase-orders:save-pdf", "savePdf", { id: unknownId, extra: 1 }],
      ["purchase-orders:print", "print", { id: "x" }],
      ["purchase-orders:print", "print", {}],
    ] as const)("%s rejects bad input", async (channel, method, input) => {
      signIn("owner");
      const spy = vi.spyOn(purchaseOrderDocumentsService, method);
      await expect(invoke(channel, input)).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
    });

    it("is refused when signed out", async () => {
      sessions.end();
      const requests: [string, unknown][] = [
        ["purchase-orders:list", undefined],
        ["purchase-orders:get", { id: unknownId }],
        ["purchase-orders:create", order(unknownId, unknownId)],
        ["purchase-orders:update", { id: unknownId, ...order(unknownId, unknownId) }],
        ["purchase-orders:confirm", { id: unknownId }],
        ["purchase-orders:cancel", { id: unknownId }],
        ["purchase-orders:save-pdf", { id: unknownId }],
        ["purchase-orders:print", { id: unknownId }],
      ];
      for (const [channel, input] of requests) {
        await expect(invoke(channel, input)).rejects.toThrow(
          new Error(ipcErrorMessages.unauthenticated),
        );
      }
    });
  });

  describe("export csv", () => {
    it("saves for a manager and returns the path", async () => {
      seedProduct();
      expect(await invoke("products:export-csv")).toEqual({
        status: "saved",
        path: join(dir, "catalog.csv"),
      });
      expect(existsSync(join(dir, "catalog.csv"))).toBe(true);
    });

    it("returns cancelled when the dialog is dismissed", async () => {
      signIn("owner");
      exportPath = null;
      expect(await invoke("products:export-csv")).toEqual({ status: "cancelled" });
    });

    it("saves for a cashier", async () => {
      signIn("cashier");
      expect(await invoke("products:export-csv")).toMatchObject({ status: "saved" });
    });
  });

  describe("bulk update", () => {
    it("returns the parsed ok result and audits the change", async () => {
      const product = seedProduct();
      expect(
        await invoke("products:bulk-update", {
          productIds: [product.id, product.id],
          change: bulkPrice,
        }),
      ).toEqual({ ok: true, changed: 1, unchanged: 0 });
      expect(counts().audit).toBe(1);
    });

    it("returns ineligible-products for unknown ids", async () => {
      seedProduct();
      expect(
        await invoke("products:bulk-update", { productIds: [unknownId], change: bulkPrice }),
      ).toMatchObject({ ok: false, reason: "ineligible-products", productIds: [unknownId] });
    });
  });

  describe("typed refusals", () => {
    it("returns barcode-taken, not-found and system-product", async () => {
      seedProduct();

      expect(await invoke("products:create", draft({ nameEn: "Other" }))).toMatchObject({
        ok: false,
        reason: "barcode-taken",
      });
      expect(await invoke("products:get", { id: unknownId })).toMatchObject({
        ok: false,
        reason: "not-found",
      });

      const system = database.db
        .insert(products)
        .values({
          ...database.db.select().from(products).get()!,
          id: undefined,
          internalCode: null,
          isSystem: true,
          searchText: "system",
        })
        .returning()
        .get();
      expect(await invoke("products:archive", { id: system.id })).toMatchObject({
        ok: false,
        reason: "system-product",
      });
    });
  });

  describe("session state", () => {
    const search = { query: "", limit: 5, offset: 0 };

    it("rejects reads with no session", async () => {
      await expect(invoke("products:search", search)).rejects.toThrow(
        new Error(ipcErrorMessages.unauthenticated),
      );
    });
  });
});

describe("shifts ipc", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let service: ShiftsService;
  let receipts: { openDrawer: ReturnType<typeof vi.fn> };

  const signIn = () => {
    const user = database.db
      .insert(users)
      .values({ username: "cashier", displayName: "Bilal", passwordHash: "x", pinHash: "x" })
      .returning()
      .get();
    sessions.start({
      userId: user.id,
      storeId: database.db.select().from(stores).get()!.id,
      loggedInAt: new Date(0),
    });
  };

  beforeEach(() => {
    handlers.clear();
    dir = mkdtempSync(join(tmpdir(), "vendora-ipc-shifts-"));
    database = openMigratedDatabase(join(dir, "vendora.db"));
    seedStoreAndTerminal(database);
    sessions = createSessionStore();
    service = createShiftsService({
      database,
      audit: createAuditService(database),
      sessions,
      heldBills: () => [],
    });
    receipts = { openDrawer: vi.fn() };
    const stub = {} as never;
    registerIpcHandlers({
      auth: stub,
      billDrafts: stub,
      catalogExport: stub,
      categories: stub,
      goodsReceived: stub,
      inventory: stub,
      products: stub,
      purchaseHistory: stub,
      purchaseOrderDocuments: stub,
      purchaseOrders: stub,
      purchaseReturnDocuments: stub,
      purchaseReturns: stub,
      receipts: receipts as never,
      returns: stub,
      sales: stub,
      settings: stub,
      shifts: service,
      suppliers: stub,
      taxCategories: stub,
      users: stub,
    });
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ["shifts:open", { openingFloatPaisa: 1.5 }],
    ["shifts:open", { openingFloatPaisa: -1 }],
    ["shifts:open", { openingFloatPaisa: 0, extra: 1 }],
    ["shifts:add-cash-move", { kind: "in", amountPaisa: 0, reason: "x" }],
    ["shifts:add-cash-move", { kind: "in", amountPaisa: 1.5, reason: "x" }],
    ["shifts:add-cash-move", { kind: "in", amountPaisa: 10, reason: "" }],
    ["shifts:add-cash-move", { kind: "in", amountPaisa: 10, reason: "x".repeat(121) }],
    ["shifts:delete-cash-move", { id: "not-a-uuid" }],
    ["shifts:report", { id: "not-a-uuid" }],
    ["shifts:close", { shiftId: unknownId, count: { method: "total", countedCashPaisa: -1 } }],
    [
      "shifts:close",
      {
        shiftId: unknownId,
        count: {
          method: "denominations",
          lines: [
            { denominationId: unknownId, count: 1 },
            { denominationId: unknownId, count: 2 },
          ],
        },
      },
    ],
  ])("rejects invalid input on %s before the service runs", async (channel, input) => {
    signIn();
    const spies = (["open", "addCashMove", "deleteCashMove", "report", "close"] as const).map(
      (method) => vi.spyOn(service, method),
    );

    await expect(invoke(channel, input)).rejects.toThrow();

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(database.db.select().from(auditLog).all()).toHaveLength(0);
  });

  it.each([
    "shifts:state",
    "shifts:open",
    "shifts:add-cash-move",
    "shifts:delete-cash-move",
    "shifts:report",
    "shifts:list-denominations",
    "shifts:close",
  ])("rejects %s with no session", async (channel) => {
    const input: Record<string, unknown> = {
      "shifts:open": { openingFloatPaisa: 0 },
      "shifts:add-cash-move": { kind: "in", amountPaisa: 10, reason: "x" },
      "shifts:delete-cash-move": { id: unknownId },
      "shifts:report": { id: unknownId },
      "shifts:close": { shiftId: unknownId, count: { method: "total", countedCashPaisa: 0 } },
    };

    await expect(invoke(channel, input[channel])).rejects.toThrow(
      new Error(ipcErrorMessages.unauthenticated),
    );
  });

  it("opens the drawer after a saved cash move and not after a refused one", async () => {
    signIn();
    await invoke("shifts:add-cash-move", { kind: "in", amountPaisa: 100, reason: "x" });
    expect(receipts.openDrawer).not.toHaveBeenCalled();

    await invoke("shifts:open", { openingFloatPaisa: 0 });
    await invoke("shifts:add-cash-move", { kind: "in", amountPaisa: 100, reason: "float" });
    await invoke("shifts:add-cash-move", { kind: "out", amountPaisa: 50, reason: "milk" });

    expect(receipts.openDrawer.mock.calls).toEqual([["cash_in"], ["cash_out"]]);
  });

  it("opens the drawer for a count only in the phase that matches the shift", async () => {
    signIn();
    const wrongPhase = { ok: false, reason: "wrong-phase", message: expect.any(String) };

    expect(await invoke("printer:open-drawer-for-count", { phase: "closing" })).toMatchObject(
      wrongPhase,
    );
    expect(await invoke("printer:open-drawer-for-count", { phase: "opening" })).toEqual({
      ok: true,
    });

    await invoke("shifts:open", { openingFloatPaisa: 0 });
    expect(await invoke("printer:open-drawer-for-count", { phase: "opening" })).toMatchObject(
      wrongPhase,
    );
    expect(await invoke("printer:open-drawer-for-count", { phase: "closing" })).toEqual({
      ok: true,
    });

    expect(receipts.openDrawer.mock.calls).toEqual([["opening_count"], ["closing_count"]]);
    await expect(invoke("printer:open-drawer-for-count", { phase: "x" })).rejects.toThrow();
  });

  it("opens then closes by total", async () => {
    signIn();

    const opened = await invoke("shifts:open", { openingFloatPaisa: 5000 });
    expect(opened).toMatchObject({ ok: true });
    const shiftId = (opened as { shift: { id: string } }).shift.id;
    expect(await invoke("shifts:state")).toMatchObject({ status: "open" });

    const closed = await invoke("shifts:close", {
      shiftId,
      count: { method: "total", countedCashPaisa: 5000 },
    });

    expect(closed).toMatchObject({ ok: true, report: { kind: "z", variancePaisa: 0 } });
    expect(await invoke("shifts:state")).toEqual({ status: "closed", suggestedFloatPaisa: 5000 });
  });
});

describe("checkout ipc", () => {
  let kit: CheckoutKit;
  let sales: SalesService;
  let receipts: { startAfterSale: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    handlers.clear();
    kit = createCheckoutKit();
    sales = createSalesService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      stock: createStockService({ database: kit.database, audit: kit.audit }),
    });
    receipts = { startAfterSale: vi.fn() };
    const stub = {} as never;
    registerIpcHandlers({
      auth: stub,
      billDrafts: kit.billDrafts,
      catalogExport: stub,
      categories: stub,
      goodsReceived: stub,
      inventory: stub,
      products: stub,
      purchaseHistory: stub,
      purchaseOrderDocuments: stub,
      purchaseOrders: stub,
      purchaseReturnDocuments: stub,
      purchaseReturns: stub,
      receipts: receipts as never,
      returns: kit.returns,
      sales,
      settings: stub,
      shifts: kit.shifts,
      suppliers: stub,
      taxCategories: stub,
      users: stub,
    });
  });

  afterEach(() => kit.close());

  const channelsWithInput: [string, unknown][] = [
    ["checkout:scan", { barcode: "1" }],
    ["checkout:add-product", { productId: unknownId }],
    ["checkout:add-misc", { name: "x", pricePaisa: 100 }],
    ["checkout:update-line", { lineId: unknownId, qtyMilli: 1000 }],
    ["checkout:delete-line", { lineId: unknownId }],
    ["checkout:set-bill-discount", { draftId: unknownId, discount: null }],
    ["checkout:hold", { draftId: unknownId }],
    ["checkout:resume", { draftId: unknownId }],
    ["checkout:discard", { draftId: unknownId }],
    ["checkout:toggle-return", { lineId: unknownId }],
    ["checkout:set-damaged", { lineId: unknownId, damaged: true }],
    ["returns:returnable", { saleId: unknownId }],
    [
      "returns:add-from-sale",
      { saleId: unknownId, lines: [{ saleLineId: unknownId, qtyMilli: 1000 }] },
    ],
    ["checkout:complete", { draftId: unknownId, payments: [{ method: "cash", amountPaisa: 100 }] }],
  ];

  it.each([
    ["checkout:current", undefined],
    ["checkout:list-held", undefined],
    ...channelsWithInput,
  ])("rejects %s with no session", async (channel, input) => {
    await expect(invoke(channel, input)).rejects.toThrow(
      new Error(ipcErrorMessages.unauthenticated),
    );
  });

  it.each([
    ["checkout:scan", { barcode: "" }],
    ["checkout:scan", { barcode: "1", extra: 1 }],
    ["checkout:add-product", { productId: "not-a-uuid" }],
    ["checkout:add-product", { productId: unknownId, qtyMilli: 0 }],
    ["checkout:add-misc", { name: "", pricePaisa: 100 }],
    ["checkout:add-misc", { name: "x", pricePaisa: 1.5 }],
    ["checkout:update-line", { lineId: unknownId }],
    ["checkout:update-line", { lineId: unknownId, discount: { kind: "percent", bps: 10001 } }],
    ["checkout:delete-line", { lineId: "nope" }],
    ["checkout:set-bill-discount", { draftId: unknownId, discount: { kind: "amount" } }],
    ["checkout:hold", { draftId: unknownId, label: "Mr Khan" }],
    ["checkout:resume", { draftId: "nope" }],
    ["checkout:discard", {}],
    ["checkout:toggle-return", { lineId: "nope" }],
    ["checkout:set-damaged", { lineId: unknownId }],
    ["checkout:set-damaged", { lineId: unknownId, damaged: "yes" }],
    ["returns:returnable", { saleId: "nope" }],
    ["returns:add-from-sale", { saleId: unknownId, lines: [] }],
    [
      "returns:add-from-sale",
      { saleId: unknownId, lines: [{ saleLineId: unknownId, qtyMilli: 0 }] },
    ],
    [
      "returns:add-from-sale",
      {
        saleId: unknownId,
        lines: [
          { saleLineId: unknownId, qtyMilli: 1000 },
          { saleLineId: unknownId, qtyMilli: 1000 },
        ],
      },
    ],
    [
      "returns:add-from-sale",
      { saleId: unknownId, lines: [{ saleLineId: unknownId, qtyMilli: 1000, extra: 1 }] },
    ],
    ["checkout:complete", { draftId: unknownId, payments: [{ method: "cash", amountPaisa: 1.5 }] }],
    [
      "checkout:complete",
      { draftId: unknownId, payments: [{ method: "cash", amountPaisa: 100, reference: "x" }] },
    ],
    [
      "checkout:complete",
      { draftId: unknownId, payments: [{ method: "cheque", amountPaisa: 100 }] },
    ],
  ])("rejects invalid input on %s before the service runs", async (channel, input) => {
    kit.signIn("cashier");
    const spies = (Object.keys(kit.billDrafts) as (keyof typeof kit.billDrafts)[]).map((name) =>
      vi.spyOn(kit.billDrafts, name),
    );
    const returnSpies = (Object.keys(kit.returns) as (keyof typeof kit.returns)[]).map((name) =>
      vi.spyOn(kit.returns, name),
    );
    const complete = vi.spyOn(sales, "complete");

    await expect(invoke(channel, input)).rejects.toThrow();

    for (const spy of [...spies, ...returnSpies, complete]) expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ["sales:list", {}],
    ["sales:list", { invoiceNo: "" }],
    ["sales:list", { invoiceNo: "x".repeat(33) }],
    ["sales:list", { date: "27-10-2026" }],
    ["sales:list", { scope: "all" }],
    ["sales:list", { scope: "shift", extra: 1 }],
    ["sales:get", { id: "nope" }],
    ["sales:get", {}],
  ])("rejects invalid input on %s before the service runs", async (channel, input) => {
    kit.signIn("cashier");
    const list = vi.spyOn(sales, "list");
    const get = vi.spyOn(sales, "get");

    await expect(invoke(channel, input)).rejects.toThrow();

    expect(list).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    ["sales:list", { scope: "shift" }],
    ["sales:get", { id: unknownId }],
  ])("rejects %s with no session", async (channel, input) => {
    await expect(invoke(channel, input)).rejects.toThrow(
      new Error(ipcErrorMessages.unauthenticated),
    );
  });

  it("lists a completed sale and reads its detail", async () => {
    kit.signIn("cashier");
    kit.openShift(5000);
    kit.setMiscEnabled(true);
    const added = (await invoke("checkout:add-misc", { name: "Loose tea", pricePaisa: 45000 })) as {
      bill: { id: string };
    };
    const done = (await invoke("checkout:complete", {
      draftId: added.bill.id,
      payments: [{ method: "cash", amountPaisa: 50000 }],
    })) as { sale: { id: string } };

    expect(await invoke("sales:list", { scope: "shift" })).toEqual([
      expect.objectContaining({ invoiceNo: "T1-000001", methods: ["cash"], totalPaisa: 45000 }),
    ]);
    expect(await invoke("sales:list", { invoiceNo: "1" })).toHaveLength(1);
    expect(await invoke("sales:get", { id: done.sale.id })).toMatchObject({
      ok: true,
      sale: { invoiceNo: "T1-000001", printCount: 0, changePaisa: 5000 },
    });
  });

  it("builds a bill, completes it and parses every result", async () => {
    kit.signIn("cashier");
    kit.openShift(5000);
    kit.setMiscEnabled(true);

    const added = (await invoke("checkout:add-misc", { name: "Loose tea", pricePaisa: 45000 })) as {
      ok: true;
      bill: { id: string };
    };
    expect(added).toMatchObject({ ok: true, bill: { totals: { totalPaisa: 45000 } } });
    expect(await invoke("checkout:current")).toMatchObject({ bill: { id: added.bill.id } });

    const discounted = await invoke("checkout:set-bill-discount", {
      draftId: added.bill.id,
      discount: { kind: "percent", bps: 1000 },
    });
    expect(discounted).toMatchObject({ ok: true, bill: { totals: { totalPaisa: 40500 } } });

    expect(
      await invoke("checkout:complete", {
        draftId: added.bill.id,
        payments: [{ method: "cash", amountPaisa: 50000 }],
      }),
    ).toMatchObject({ ok: true, sale: { invoiceNo: "T1-000001", changePaisa: 9500 } });
    expect(
      await invoke("checkout:complete", {
        draftId: added.bill.id,
        payments: [{ method: "cash", amountPaisa: 50000 }],
      }),
    ).toMatchObject({ ok: true, sale: { replayed: true } });
    expect(receipts.startAfterSale).toHaveBeenCalledTimes(1);
    expect(receipts.startAfterSale).toHaveBeenCalledWith(expect.any(String));
  });

  it("starts no print when the sale is refused", async () => {
    kit.signIn("cashier");
    kit.openShift();

    await invoke("checkout:complete", {
      draftId: unknownId,
      payments: [{ method: "cash", amountPaisa: 100 }],
    });

    expect(receipts.startAfterSale).not.toHaveBeenCalled();
  });

  it("holds a bill and lists it", async () => {
    kit.signIn("cashier");
    kit.openShift();
    kit.setMiscEnabled(true);
    const added = (await invoke("checkout:add-misc", { name: "Sugar", pricePaisa: 16000 })) as {
      bill: { id: string };
    };

    expect(await invoke("checkout:hold", { draftId: added.bill.id })).toEqual({
      ok: true,
    });
    expect(await invoke("checkout:list-held")).toEqual([
      expect.objectContaining({ lineCount: 1, itemNames: ["Sugar"], totalPaisa: 16000 }),
    ]);
    expect(await invoke("shifts:state")).toMatchObject({
      heldBills: [expect.objectContaining({ lineCount: 1 })],
    });
  });
});

describe("inventory ipc", () => {
  let kit: CheckoutKit;
  let service: InventoryService;

  beforeEach(() => {
    handlers.clear();
    kit = createCheckoutKit();
    service = createInventoryService({
      database: kit.database,
      sessions: kit.sessions,
      stock: kit.stock,
    });
    const stub = {} as never;
    registerIpcHandlers({
      auth: stub,
      billDrafts: stub,
      catalogExport: stub,
      categories: stub,
      goodsReceived: stub,
      inventory: service,
      products: stub,
      purchaseHistory: stub,
      purchaseOrderDocuments: stub,
      purchaseOrders: stub,
      purchaseReturnDocuments: stub,
      purchaseReturns: stub,
      receipts: stub,
      returns: stub,
      sales: stub,
      settings: stub,
      shifts: stub,
      suppliers: stub,
      taxCategories: stub,
      users: stub,
    });
    kit.signIn("cashier");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    kit.close();
  });

  it.each([
    ["inventory:list-stock", "list", { query: "", limit: 101, offset: 0 }],
    ["inventory:list-stock", "list", { query: "", limit: 10, offset: 0, extra: 1 }],
    ["inventory:list-stock", "list", { query: "", limit: 10, offset: 0, includeArchived: true }],
    ["inventory:low-stock", "lowStock", { limit: 101, offset: 0 }],
    ["inventory:low-stock", "lowStock", { limit: 10, offset: 0, extra: 1 }],
    ["inventory:low-stock", "lowStock", { limit: 10, offset: 0, categoryId: "x" }],
    ["inventory:low-stock", "lowStock", { limit: 10, offset: 0, query: "" }],
    ["inventory:stock-history", "history", { productId: "x", limit: 10, offset: 0 }],
    ["inventory:stock-history", "history", { productId: unknownId, limit: 101, offset: 0 }],
    [
      "inventory:stock-history",
      "history",
      { productId: unknownId, limit: 10, offset: 0, extra: 1 },
    ],
  ] as const)("%s rejects bad input", async (channel, method, input) => {
    const spy = vi.spyOn(service, method);
    await expect(invoke(channel, input)).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it("lists stock and returns a refusal for an unknown product", async () => {
    const tea = kit.addProduct({ nameEn: "Tea", searchText: "tea", costPaisa: 1000 });
    expect(await invoke("inventory:list-stock", { query: "", limit: 10, offset: 0 })).toMatchObject(
      {
        total: 1,
        items: [{ id: tea.id, onHandMilli: 0, costPaisa: 1000, stockValuePaisa: 0 }],
      },
    );
    expect(
      await invoke("inventory:stock-history", { productId: unknownId, limit: 10, offset: 0 }),
    ).toMatchObject({ ok: false, reason: "not-found" });
  });

  it("lists low-stock products", async () => {
    const tea = kit.addProduct({
      nameEn: "Tea",
      searchText: "tea",
      lowStockThresholdMilli: 5000,
    });
    expect(await invoke("inventory:low-stock", { limit: 10, offset: 0 })).toMatchObject({
      total: 1,
      items: [{ id: tea.id, onHandMilli: 0, thresholdMilli: 5000, shortfallMilli: 5000 }],
    });
  });

  it("rejects reads with no session", async () => {
    kit.sessions.end();
    await expect(
      invoke("inventory:list-stock", { query: "", limit: 10, offset: 0 }),
    ).rejects.toThrow(new Error(ipcErrorMessages.unauthenticated));
    await expect(invoke("inventory:low-stock", { limit: 10, offset: 0 })).rejects.toThrow(
      new Error(ipcErrorMessages.unauthenticated),
    );
  });
});
