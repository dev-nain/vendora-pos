import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ipcChannels, ipcErrorMessages } from "@shared/ipc";
import { createProductInputSchema } from "@shared/products";
import { createSessionStore, type SessionStore } from "./auth/session";
import type { VendoraDatabase } from "./db/client";
import { auditLog, categories, products, stores, taxCategories, users } from "./db/schema";
import { seedStoreAndTerminal } from "./db/seed";
import { registerIpcHandlers, registerStartupHandlers } from "./ipc";
import { createAuditService } from "./services/audit";
import { createRecoveryService } from "./services/recovery";
import { createBackupSettingsService } from "./services/backup-settings";
import { createCatalogExportService } from "./services/catalog-export";
import { createProductsService, type ProductsService } from "./services/products";
import { createCheckoutKit, type CheckoutKit } from "./services/checkout-test-kit";
import { createSalesService, type SalesService } from "./services/sales";
import { createSettingsService, type SettingsService } from "./services/settings";
import {
  createPurchaseOrderDocumentsService,
  type PurchaseOrderDocumentsService,
} from "./services/purchase-order-documents";
import {
  createPurchaseOrdersService,
  type PurchaseOrdersService,
} from "./services/purchase-orders";
import { createReportsService, type ReportsService } from "./services/reports";
import { createSaleInvoicesService, type SaleInvoicesService } from "./services/sale-invoices";
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
import { createStocktakeService, type StocktakeService } from "./services/stocktake";
import { openMigratedDatabase } from "./db/test-database";
import { createInventoryService, type InventoryService } from "./services/inventory";
import { createAuditLogService, type AuditLogService } from "./services/audit-log";

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

const goodBackupName = "vendora-2026-11-06T12-30-00-123Z.db";
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
  let purchaseReturnsService: PurchaseReturnsService;
  let purchaseHistoryService: PurchaseHistoryService;
  let purchaseReturnDocumentsService: PurchaseReturnDocumentsService;
  let service: ProductsService;
  let suppliersService: SuppliersService;
  let purchaseOrdersService: PurchaseOrdersService;
  let settingsService: SettingsService;
  let purchaseOrderDocumentsService: PurchaseOrderDocumentsService;
  let saleInvoicesService: SaleInvoicesService;
  const renderer = { toPdf: vi.fn(async () => Buffer.from("%PDF-")), print: vi.fn() };
  let goodsReceivedService: GoodsReceivedService;
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
    settingsService = createSettingsService({
      database,
      audit: createAuditService(database),
      sessions,
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
    saleInvoicesService = createSaleInvoicesService({
      database,
      sessions,
      renderer,
      chooseSavePath: async () => join(dir, "invoice.pdf"),
    });
    goodsReceivedService = createGoodsReceivedService({
      database,
      audit: createAuditService(database),
      sessions,
      stock: createStockService({ database, audit: createAuditService(database) }),
    });
    exportPath = join(dir, "catalog.csv");
    const catalogExport = createCatalogExportService({
      database,
      sessions,
      chooseSavePath: async () => exportPath,
    });
    const stub = {} as never;
    registerIpcHandlers({
      auditLog: stub,
      auth: stub,
      backupAdmin: stub,
      backupPassword: stub,
      backupSettings: stub,
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
      reports: stub,
      returns: stub,
      saleInvoices: saleInvoicesService,
      sales: stub,
      settings: settingsService,
      shifts: stub,
      stocktake: stub,
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
      ["goods-received:low-margin", "lowMargin", { id: "x" }],
      ["goods-received:low-margin", "lowMargin", { id: unknownId, extra: 1 }],
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
      ["goods-received:low-margin", { id: unknownId }],
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

  describe("margin threshold", () => {
    it.each([
      { thresholdBps: 1.5 },
      { thresholdBps: -1 },
      { thresholdBps: 10001 },
      { thresholdBps: "15" },
      { thresholdBps: 1500, extra: 1 },
      {},
    ])("rejects bad input %j before the service runs", async (input) => {
      signIn("owner");
      const spy = vi.spyOn(settingsService, "setMarginThreshold");
      await expect(invoke("settings:set-margin-threshold", input)).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
    });

    it("refuses both channels when signed out", async () => {
      const expected = new Error(ipcErrorMessages.unauthenticated);
      await expect(invoke("settings:get-margin-threshold")).rejects.toThrow(expected);
      await expect(invoke("settings:set-margin-threshold", { thresholdBps: 1500 })).rejects.toThrow(
        expected,
      );
    });

    it("saves, reads back and turns off", async () => {
      signIn("owner");
      expect(await invoke("settings:get-margin-threshold")).toEqual({ thresholdBps: null });
      expect(await invoke("settings:set-margin-threshold", { thresholdBps: 1500 })).toEqual({
        thresholdBps: 1500,
      });
      expect(await invoke("settings:get-margin-threshold")).toEqual({ thresholdBps: 1500 });
      expect(await invoke("settings:set-margin-threshold", { thresholdBps: null })).toEqual({
        thresholdBps: null,
      });
    });

    it("returns the parsed low-margin list for a posted note", async () => {
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
      await invoke("settings:set-margin-threshold", { thresholdBps: 10000 });

      expect(await invoke("goods-received:low-margin", { id: posted.note.id })).toMatchObject({
        ok: true,
        thresholdBps: 10000,
        items: [{ productId: product.id }],
      });
      expect(await invoke("goods-received:low-margin", { id: unknownId })).toMatchObject({
        ok: false,
        reason: "not-found",
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

    it.each([
      ["invoices:save-pdf", "savePdf", { saleId: "x" }],
      ["invoices:save-pdf", "savePdf", { saleId: unknownId, extra: 1 }],
      ["invoices:print", "print", { saleId: "x" }],
      ["invoices:print", "print", {}],
    ] as const)("%s rejects bad input", async (channel, method, input) => {
      signIn("owner");
      const spy = vi.spyOn(saleInvoicesService, method);
      await expect(invoke(channel, input)).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
    });

    it("refuses invoice requests when signed out", async () => {
      sessions.end();
      for (const channel of ["invoices:save-pdf", "invoices:print"]) {
        await expect(invoke(channel, { saleId: unknownId })).rejects.toThrow(
          new Error(ipcErrorMessages.unauthenticated),
        );
      }
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
      auditLog: stub,
      auth: stub,
      backupAdmin: stub,
      backupPassword: stub,
      backupSettings: stub,
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
      reports: stub,
      returns: stub,
      saleInvoices: stub,
      sales: stub,
      settings: stub,
      shifts: service,
      stocktake: stub,
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
      auditLog: stub,
      auth: stub,
      backupAdmin: stub,
      backupPassword: stub,
      backupSettings: stub,
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
      reports: stub,
      returns: kit.returns,
      saleInvoices: stub,
      sales,
      settings: stub,
      shifts: kit.shifts,
      stocktake: stub,
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

describe("backup settings ipc", () => {
  let kit: CheckoutKit;
  let folder: string;

  beforeEach(() => {
    handlers.clear();
    kit = createCheckoutKit();
    folder = join(kit.dir, "usb");
    const backupSettings = createBackupSettingsService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      chooseFolder: async () => folder,
    });
    const stub = {} as never;
    registerIpcHandlers({
      auditLog: stub,
      auth: stub,
      backupAdmin: stub,
      backupPassword: stub,
      backupSettings,
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
      receipts: stub,
      reports: stub,
      returns: stub,
      saleInvoices: stub,
      sales: stub,
      settings: stub,
      shifts: stub,
      stocktake: stub,
      suppliers: stub,
      taxCategories: stub,
      users: stub,
    });
  });

  afterEach(() => kit.close());

  it("ignores a path passed by the caller to the choose channel", async () => {
    kit.signIn("cashier");

    const status = await invoke("settings:choose-second-copy-folder", "/etc");

    expect(status).toEqual({ folder, lastCopy: null });
  });
});

describe("backup ipc", () => {
  const admin = {
    status: vi.fn(),
    backupNow: vi.fn(),
    chooseRestoreFile: vi.fn(),
    restore: vi.fn(),
  };

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    const stub = {} as never;
    registerIpcHandlers({
      auditLog: stub,
      auth: stub,
      backupAdmin: admin as never,
      backupPassword: stub,
      backupSettings: stub,
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
      receipts: stub,
      reports: stub,
      returns: stub,
      saleInvoices: stub,
      sales: stub,
      settings: stub,
      shifts: stub,
      stocktake: stub,
      suppliers: stub,
      taxCategories: stub,
      users: stub,
    });
  });

  it("parses every output", async () => {
    admin.status.mockResolvedValue({
      lastBackupAt: null,
      lastFailure: null,
      backups: [],
      restoreBlock: null,
    });
    admin.backupNow.mockResolvedValue({ ok: true });
    admin.chooseRestoreFile.mockResolvedValue(null);
    admin.restore.mockResolvedValue({ ok: true });

    expect(await invoke("backup:status")).toMatchObject({ backups: [] });
    expect(await invoke("backup:run")).toEqual({ ok: true });
    expect(await invoke("backup:choose-file")).toBeNull();
    expect(await invoke("backup:restore", { kind: "listed", fileName: goodBackupName })).toEqual({
      ok: true,
    });
    expect(admin.restore).toHaveBeenCalledWith({ kind: "listed", fileName: goodBackupName });
  });

  it("rejects a malformed service answer", async () => {
    admin.status.mockResolvedValue({ lastBackupAt: "yesterday" });

    await expect(invoke("backup:status")).rejects.toThrow();
  });

  it.each([
    { kind: "listed", fileName: "../vendora.db" },
    { kind: "listed", fileName: "C:\\Users\\x\\vendora-2026-11-06T12-30-00-123Z.db" },
    { kind: "listed", fileName: "/etc/passwd" },
    { kind: "listed", fileName: `sub/${goodBackupName}` },
    { kind: "picked", token: "not-a-uuid" },
    { kind: "picked", token: unknownId, path: "/tmp/x.db" },
    { kind: "other" },
    { fileName: goodBackupName },
  ])("rejects restore input %j before the service runs", async (input) => {
    await expect(invoke("backup:restore", input)).rejects.toThrow();
    expect(admin.restore).not.toHaveBeenCalled();
  });
});

describe("backup password ipc", () => {
  const service = {
    status: vi.fn(),
    turnOn: vi.fn(),
    change: vi.fn(),
    turnOff: vi.fn(),
  };

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    const stub = {} as never;
    registerIpcHandlers({
      auditLog: stub,
      auth: stub,
      backupAdmin: stub,
      backupPassword: service as never,
      backupSettings: stub,
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
      receipts: stub,
      reports: stub,
      returns: stub,
      saleInvoices: stub,
      sales: stub,
      settings: stub,
      shifts: stub,
      stocktake: stub,
      suppliers: stub,
      taxCategories: stub,
      users: stub,
    });
  });

  it("parses input and output on all four channels", async () => {
    service.status.mockResolvedValue({ state: "off" });
    service.turnOn.mockResolvedValue({ ok: true, status: { state: "on" } });
    service.change.mockResolvedValue({ ok: true, status: { state: "on" } });
    service.turnOff.mockResolvedValue({ ok: true, status: { state: "off" } });

    expect(await invoke("backup:password-status")).toEqual({ state: "off" });
    await invoke("backup:password-turn-on", { password: "blue horse 7" });
    await invoke("backup:password-change", { current: "blue horse 7", next: "green horse 8" });
    await invoke("backup:password-turn-off", { current: "green horse 8" });

    expect(service.turnOn).toHaveBeenCalledWith({ password: "blue horse 7" });
    expect(service.change).toHaveBeenCalledWith({ current: "blue horse 7", next: "green horse 8" });
    expect(service.turnOff).toHaveBeenCalledWith({ current: "green horse 8" });
  });

  it.each([
    ["backup:password-turn-on", { password: "short" }],
    ["backup:password-turn-on", { password: "blue horse 7", extra: 1 }],
    ["backup:password-change", { current: "", next: "green horse 8" }],
    ["backup:password-change", { current: "x", next: "short" }],
    ["backup:password-turn-off", { current: "" }],
    ["backup:password-turn-off", {}],
  ])("rejects %s input %j before the service runs", async (channel, input) => {
    await expect(invoke(channel, input)).rejects.toThrow();

    expect(service.turnOn).not.toHaveBeenCalled();
    expect(service.change).not.toHaveBeenCalled();
    expect(service.turnOff).not.toHaveBeenCalled();
  });

  it("keeps a rejected password out of the error", async () => {
    const error = await invoke("backup:password-turn-on", { password: "short7" }).catch(
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain("short7");
  });

  it("rejects a malformed service answer", async () => {
    service.status.mockResolvedValue({ state: "maybe" });

    await expect(invoke("backup:password-status")).rejects.toThrow();
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
      auditLog: stub,
      auth: stub,
      backupAdmin: stub,
      backupPassword: stub,
      backupSettings: stub,
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
      reports: stub,
      returns: stub,
      saleInvoices: stub,
      sales: stub,
      settings: stub,
      shifts: stub,
      stocktake: stub,
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
    ["inventory:negative-stock", "negativeStock", { limit: 101, offset: 0 }],
    ["inventory:negative-stock", "negativeStock", { limit: 0, offset: 0 }],
    ["inventory:negative-stock", "negativeStock", { limit: 10, offset: -1 }],
    ["inventory:negative-stock", "negativeStock", { limit: 10, offset: 0, extra: 1 }],
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

  describe("adjust stock", () => {
    const productId = unknownId;
    const change = { mode: "change", productId, qtyMilli: -1000, reason: "theft" };
    const count = { mode: "count", productId, countedMilli: 5000, reason: "correction" };

    it.each([
      ["no reason", { mode: "change", productId, qtyMilli: -1000 }],
      ["unknown reason", { ...change, reason: "lost" }],
      ["zero quantity", { ...change, qtyMilli: 0 }],
      ["fractional quantity", { ...change, qtyMilli: 1.5 }],
      ["quantity over the limit", { ...change, qtyMilli: 1_000_000_001 }],
      ["negative count", { ...count, countedMilli: -1 }],
      ["fractional count", { ...count, countedMilli: 1.5 }],
      ["unknown mode", { ...change, mode: "set" }],
      ["bad product id", { ...change, productId: "x" }],
      ["extra actor", { ...change, actorUserId: unknownId }],
    ])("rejects %s", async (_name, input) => {
      const spy = vi.spyOn(service, "adjustStock");
      await expect(invoke("inventory:adjust-stock", input)).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
    });

    it("passes both modes to the service", async () => {
      const spy = vi.spyOn(service, "adjustStock");
      for (const input of [change, count]) {
        expect(await invoke("inventory:adjust-stock", input)).toMatchObject({
          ok: false,
          reason: "not-found",
        });
        expect(spy).toHaveBeenLastCalledWith(input);
      }
    });

    it("rejects with no session", async () => {
      kit.sessions.end();
      await expect(invoke("inventory:adjust-stock", change)).rejects.toThrow(
        new Error(ipcErrorMessages.unauthenticated),
      );
    });
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

  it("lists negative stock for valid input", async () => {
    expect(await invoke("inventory:negative-stock", { limit: 10, offset: 0 })).toEqual({
      items: [],
      total: 0,
    });
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
    await expect(invoke("inventory:negative-stock", { limit: 10, offset: 0 })).rejects.toThrow(
      new Error(ipcErrorMessages.unauthenticated),
    );
  });
});

describe("audit log ipc", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let service: AuditLogService;
  let userId: string;
  const cursorId = "0192f3a0-0000-7000-8000-000000000098";

  beforeEach(() => {
    handlers.clear();
    dir = mkdtempSync(join(tmpdir(), "vendora-ipc-audit-"));
    database = openMigratedDatabase(join(dir, "vendora.db"));
    seedStoreAndTerminal(database);
    userId = database.db
      .insert(users)
      .values({ username: "owner", displayName: "Owner", passwordHash: "x", pinHash: "x" })
      .returning()
      .get().id;
    sessions = createSessionStore();
    sessions.start({
      userId,
      storeId: database.db.select().from(stores).get()!.id,
      loggedInAt: new Date(0),
    });
    const audit = createAuditService(database);
    audit.record({ action: "login", actorUserId: userId });
    audit.record({ action: "logout", actorUserId: userId });
    service = createAuditLogService({ database, sessions });
    const stub = {} as never;
    registerIpcHandlers({
      auditLog: service,
      auth: stub,
      backupAdmin: stub,
      backupPassword: stub,
      backupSettings: stub,
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
      receipts: stub,
      reports: stub,
      returns: stub,
      saleInvoices: stub,
      sales: stub,
      settings: stub,
      shifts: stub,
      stocktake: stub,
      suppliers: stub,
      taxCategories: stub,
      users: stub,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns a filtered page through the schemas", async () => {
    expect(await invoke("audit:list", { action: "logout", userId })).toMatchObject({
      entries: [{ action: "logout", actorName: "Owner" }],
      nextCursor: null,
    });
    expect(await invoke("audit:users")).toEqual([{ id: userId, displayName: "Owner" }]);
  });

  it.each([
    { sort: "asc" },
    { userId: "x" },
    { from: "2026-02-01", to: "2026-01-01" },
    { before: { createdAt: "2026-01-01T00:00:00.000Z", id: cursorId, extra: 1 } },
  ])("refuses invalid input %j without calling the service", async (input) => {
    const spy = vi.spyOn(service, "list");
    await expect(invoke("audit:list", input)).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it("registers only the two read channels", () => {
    const channels = Object.values(ipcChannels);
    expect(channels.filter((name) => name.startsWith("audit:")).toSorted()).toEqual([
      "audit:list",
      "audit:users",
    ]);
    expect([...handlers.keys()].filter((name) => name.startsWith("audit:")).toSorted()).toEqual([
      "audit:list",
      "audit:users",
    ]);
    const writeVerb = /update|delete|remove|edit|create|write|clear/;
    expect(
      [...handlers.keys()].filter((name) => /audit/.test(name) && writeVerb.test(name)),
    ).toEqual([]);
  });

  it("refuses both channels with no session", async () => {
    sessions.end();
    for (const channel of ["audit:list", "audit:users"]) {
      await expect(invoke(channel, {})).rejects.toThrow(
        new Error(ipcErrorMessages.unauthenticated),
      );
    }
  });
});

describe("stocktake ipc", () => {
  let kit: CheckoutKit;
  let service: StocktakeService;

  beforeEach(() => {
    handlers.clear();
    kit = createCheckoutKit();
    service = createStocktakeService({
      database: kit.database,
      sessions: kit.sessions,
      stock: kit.stock,
      audit: kit.audit,
    });
    const stub = {} as never;
    registerIpcHandlers({
      auditLog: stub,
      auth: stub,
      backupAdmin: stub,
      backupPassword: stub,
      backupSettings: stub,
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
      receipts: stub,
      reports: stub,
      returns: stub,
      saleInvoices: stub,
      sales: stub,
      settings: stub,
      shifts: stub,
      stocktake: service,
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
    ["stocktake:start", "start", { scope: "category" }],
    ["stocktake:start", "start", { scope: "category", categoryId: "x" }],
    ["stocktake:start", "start", { scope: "full", extra: 1 }],
    ["stocktake:start", "start", { scope: "other" }],
    ["stocktake:lines", "lines", { stocktakeId: "x", query: "", limit: 10, offset: 0 }],
    ["stocktake:lines", "lines", { stocktakeId: unknownId, query: "", limit: 101, offset: 0 }],
    [
      "stocktake:lines",
      "lines",
      { stocktakeId: unknownId, query: "", limit: 10, offset: 0, extra: 1 },
    ],
    ["stocktake:scan", "scan", { stocktakeId: unknownId, barcode: "  " }],
    ["stocktake:scan", "scan", { stocktakeId: "x", barcode: "123" }],
    ["stocktake:record", "record", { stocktakeId: unknownId, lineId: unknownId, countedMilli: -1 }],
    [
      "stocktake:record",
      "record",
      { stocktakeId: unknownId, lineId: unknownId, countedMilli: 1.5 },
    ],
    [
      "stocktake:record",
      "record",
      { stocktakeId: unknownId, lineId: unknownId, countedMilli: 1_000_000_001 },
    ],
    [
      "stocktake:record",
      "record",
      { stocktakeId: unknownId, lineId: unknownId, countedMilli: 1000, extra: 1 },
    ],
    ["stocktake:record", "record", { stocktakeId: unknownId, lineId: "x", countedMilli: 1000 }],
    ["stocktake:cancel", "cancel", { stocktakeId: "x" }],
    ["stocktake:cancel", "cancel", { stocktakeId: unknownId, extra: 1 }],
  ] as const)("%s rejects bad input", async (channel, method, input) => {
    const spy = vi.spyOn(service, method);
    await expect(invoke(channel, input)).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it("starts, scans and cancels a count", async () => {
    const tea = kit.addProduct({ nameEn: "Tea", searchText: "tea" });
    kit.addBarcode(tea.id, "8961000000011");

    expect(await invoke("stocktake:current")).toBeNull();
    const started = (await invoke("stocktake:start", { scope: "full" })) as {
      stocktake: { id: string };
    };
    const stocktakeId = started.stocktake.id;
    expect(await invoke("stocktake:scan", { stocktakeId, barcode: "8961000000011" })).toMatchObject(
      { ok: true, line: { productId: tea.id } },
    );
    expect(await invoke("stocktake:cancel", { stocktakeId })).toEqual({ ok: true });
    expect(await invoke("stocktake:cancel", { stocktakeId })).toMatchObject({
      ok: false,
      reason: "not-open",
    });
  });

  it("rejects calls with no session", async () => {
    kit.sessions.end();
    await expect(invoke("stocktake:current")).rejects.toThrow(
      new Error(ipcErrorMessages.unauthenticated),
    );
    await expect(invoke("stocktake:start", { scope: "full" })).rejects.toThrow(
      new Error(ipcErrorMessages.unauthenticated),
    );
  });
});

const buildRecovery = (state: Parameters<typeof createRecoveryService>[0]["state"]) => {
  const restore = vi.fn();
  const relaunch = vi.fn();
  registerStartupHandlers(
    createRecoveryService({
      state,
      backupDir: join(tmpdir(), "vendora-no-backups"),
      migrationsFolder: join(process.cwd(), "drizzle"),
      chooseFile: async () => null,
      restores: { restore },
      relaunch,
    }),
  );
  return { restore, relaunch };
};

describe("recovery ipc", () => {
  beforeEach(() => {
    handlers.clear();
  });

  it("answers app info and the startup state in any mode", async () => {
    buildRecovery({ mode: "normal" });

    expect(await invoke("app:get-info")).toEqual({ version: "0.0.0" });
    expect(await invoke("startup:state")).toEqual({ mode: "normal" });
  });

  it.each([
    ["recovery:scan", undefined],
    ["recovery:choose-file", undefined],
    ["recovery:restore", { kind: "listed", fileName: goodBackupName }],
    ["recovery:retry", undefined],
  ])("refuses %s outside recovery mode", async (channel, input) => {
    const { restore, relaunch } = buildRecovery({ mode: "normal" });

    await expect(invoke(channel, input)).rejects.toThrow(
      new Error(ipcErrorMessages.recoveryUnavailable),
    );
    expect(restore).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("parses the restore input before the service runs", async () => {
    const { restore } = buildRecovery({ mode: "damaged" });

    await expect(
      invoke("recovery:restore", { kind: "listed", fileName: "../x.db" }),
    ).rejects.toThrow();
    await expect(invoke("recovery:restore", { kind: "picked", token: "nope" })).rejects.toThrow();
    expect(restore).not.toHaveBeenCalled();
  });

  it("scans in recovery mode", async () => {
    buildRecovery({ mode: "damaged" });

    expect(await invoke("recovery:scan")).toEqual({ backups: [], lastGood: null });
  });
});

describe("reports ipc", () => {
  let kit: CheckoutKit;
  let service: ReportsService;
  const range = { from: "2026-11-01", to: "2026-11-07" };

  beforeEach(() => {
    handlers.clear();
    kit = createCheckoutKit();
    service = createReportsService({
      database: kit.database,
      sessions: kit.sessions,
      renderer: { toPdf: async () => Buffer.from("%PDF-"), print: async () => "printed" },
      chooseSavePath: async (fileName) => join(kit.dir, fileName),
    });
    const stub = {} as never;
    registerIpcHandlers({
      auditLog: stub,
      auth: stub,
      backupAdmin: stub,
      backupPassword: stub,
      backupSettings: stub,
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
      receipts: stub,
      reports: service,
      returns: stub,
      saleInvoices: stub,
      sales: stub,
      settings: stub,
      shifts: stub,
      stocktake: stub,
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
    ["reports:sales-by-day", "salesByDay", { from: "2026-13-01", to: "2026-11-07" }],
    ["reports:sales-by-day", "salesByDay", { from: "2026-11-08", to: "2026-11-07" }],
    ["reports:sales-by-day", "salesByDay", { ...range, extra: 1 }],
    ["reports:export-sales-by-day", "exportSalesByDay", { range, format: "xlsx" }],
    ["reports:export-sales-by-day", "exportSalesByDay", { range, format: "csv", extra: 1 }],
    [
      "reports:export-sales-by-day",
      "exportSalesByDay",
      { range: { from: "2026-11-08", to: "2026-11-07" }, format: "pdf" },
    ],
    ["reports:export-sales-by-day", "exportSalesByDay", { range }],
    [
      "reports:gross-profit-by-product",
      "grossProfitByProduct",
      { from: "2026-13-01", to: range.to },
    ],
    ["reports:gross-profit-by-product", "grossProfitByProduct", { ...range, extra: 1 }],
    [
      "reports:gross-profit-by-category",
      "grossProfitByCategory",
      { from: range.to, to: range.from },
    ],
    ["reports:gross-profit-by-category", "grossProfitByCategory", { ...range, extra: 1 }],
    [
      "reports:export-gross-profit-by-product",
      "exportGrossProfitByProduct",
      { range, format: "xlsx" },
    ],
    ["reports:export-gross-profit-by-product", "exportGrossProfitByProduct", { range }],
    [
      "reports:export-gross-profit-by-category",
      "exportGrossProfitByCategory",
      { range, format: "csv", extra: 1 },
    ],
    ["reports:export-gross-profit-by-category", "exportGrossProfitByCategory", { range }],
    [
      "reports:discounts-returns-voids",
      "discountsReturnsVoids",
      { from: "2026-11-08", to: "2026-11-07" },
    ],
    ["reports:discounts-returns-voids", "discountsReturnsVoids", { ...range, extra: 1 }],
    [
      "reports:export-discounts-returns-voids",
      "exportDiscountsReturnsVoids",
      { range, format: "xlsx" },
    ],
    [
      "reports:export-discounts-returns-voids",
      "exportDiscountsReturnsVoids",
      { range, format: "csv", extra: 1 },
    ],
    ["reports:sales-tax-summary", "salesTaxSummary", { from: "2026-13-01", to: "2026-11-07" }],
    ["reports:sales-tax-summary", "salesTaxSummary", { from: "2026-11-08", to: "2026-11-07" }],
    ["reports:sales-tax-summary", "salesTaxSummary", { ...range, extra: 1 }],
    ["reports:export-sales-tax-summary", "exportSalesTaxSummary", { range, format: "xlsx" }],
    [
      "reports:export-sales-tax-summary",
      "exportSalesTaxSummary",
      { range, format: "csv", extra: 1 },
    ],
    ["reports:export-sales-tax-summary", "exportSalesTaxSummary", { range }],
  ] as const)("%s rejects bad input", async (channel, method, input) => {
    const spy = vi.spyOn(service, method);
    await expect(invoke(channel, input)).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns an empty report and exports it", async () => {
    expect(await invoke("reports:sales-by-day", range)).toMatchObject({
      rows: [],
      totals: { billCount: 0, totalPaisa: 0 },
    });
    expect(await invoke("reports:export-sales-by-day", { range, format: "csv" })).toEqual({
      ok: true,
      status: "saved",
      path: join(kit.dir, "sales-by-day-2026-11-01-to-2026-11-07.csv"),
    });
    expect(await invoke("reports:sales-tax-summary", range)).toEqual({
      rows: [],
      totals: { taxablePaisa: 0, taxPaisa: 0, totalPaisa: 0 },
    });
    expect(await invoke("reports:export-sales-tax-summary", { range, format: "csv" })).toEqual({
      ok: true,
      status: "saved",
      path: join(kit.dir, "sales-tax-summary-2026-11-01-to-2026-11-07.csv"),
    });
  });

  it("returns an empty discounts, returns and voids report and exports it", async () => {
    expect(await invoke("reports:discounts-returns-voids", range)).toMatchObject({
      discounts: { billCount: 0, bills: [] },
      returns: { lineCount: 0, lines: [] },
      voids: { deletedLines: { count: 0 }, discardedBills: { count: 0 } },
    });
    expect(
      await invoke("reports:export-discounts-returns-voids", { range, format: "csv" }),
    ).toEqual({
      ok: true,
      status: "saved",
      path: join(kit.dir, "discounts-returns-voids-2026-11-01-to-2026-11-07.csv"),
    });
  });

  it.each(["product", "category"])("returns an empty gross profit by %s report", async (by) => {
    expect(await invoke(`reports:gross-profit-by-${by}`, range)).toMatchObject({
      rows: [],
      totals: { netPaisa: 0, marginBps: null },
      footer: [],
    });
    expect(await invoke(`reports:export-gross-profit-by-${by}`, { range, format: "csv" })).toEqual({
      ok: true,
      status: "saved",
      path: join(kit.dir, `gross-profit-by-${by}-2026-11-01-to-2026-11-07.csv`),
    });
  });

  it("is refused when signed out", async () => {
    kit.sessions.end();
    await expect(invoke("reports:discounts-returns-voids", range)).rejects.toThrow(
      new Error(ipcErrorMessages.unauthenticated),
    );
    await expect(invoke("reports:sales-by-day", range)).rejects.toThrow(
      new Error(ipcErrorMessages.unauthenticated),
    );
    await expect(invoke("reports:export-sales-by-day", { range, format: "pdf" })).rejects.toThrow(
      new Error(ipcErrorMessages.unauthenticated),
    );
    for (const by of ["product", "category"]) {
      await expect(invoke(`reports:gross-profit-by-${by}`, range)).rejects.toThrow(
        new Error(ipcErrorMessages.unauthenticated),
      );
      await expect(
        invoke(`reports:export-gross-profit-by-${by}`, { range, format: "pdf" }),
      ).rejects.toThrow(new Error(ipcErrorMessages.unauthenticated));
    }
    await expect(invoke("reports:sales-tax-summary", range)).rejects.toThrow(
      new Error(ipcErrorMessages.unauthenticated),
    );
    await expect(
      invoke("reports:export-sales-tax-summary", { range, format: "pdf" }),
    ).rejects.toThrow(new Error(ipcErrorMessages.unauthenticated));
  });
});
