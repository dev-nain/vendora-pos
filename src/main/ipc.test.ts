import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ipcErrorMessages } from "@shared/ipc";
import { createProductInputSchema } from "@shared/products";
import { createSessionStore, type SessionStore } from "./auth/session";
import { openDatabase, type VendoraDatabase } from "./db/client";
import { runMigrations } from "./db/migrate";
import { auditLog, categories, products, stores, taxCategories, users } from "./db/schema";
import { seedStoreAndTerminal } from "./db/seed";
import { registerIpcHandlers } from "./ipc";
import { createAuditService } from "./services/audit";
import { createCatalogExportService } from "./services/catalog-export";
import { createProductsService, type ProductsService } from "./services/products";
import { createCheckoutKit, type CheckoutKit } from "./services/checkout-test-kit";
import { createSalesService, type SalesService } from "./services/sales";
import { createShiftsService, type ShiftsService } from "./services/shifts";
import { createStockService } from "./services/stock";

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

describe("products ipc", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let service: ProductsService;
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
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, {
      migrationsFolder: join(process.cwd(), "drizzle"),
      backupDir: join(dir, "backups"),
    });
    seedStoreAndTerminal(database);
    categoryId = database.db.select().from(categories).get()!.id;
    taxCategoryId = database.db.select().from(taxCategories).get()!.id;
    sessions = createSessionStore();
    service = createProductsService({ database, audit: createAuditService(database), sessions });
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
      products: service,
      sales: stub,
      settings: stub,
      shifts: stub,
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
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, {
      migrationsFolder: join(process.cwd(), "drizzle"),
      backupDir: join(dir, "backups"),
    });
    seedStoreAndTerminal(database);
    sessions = createSessionStore();
    service = createShiftsService({
      database,
      audit: createAuditService(database),
      sessions,
      heldBills: () => [],
    });
    const stub = {} as never;
    registerIpcHandlers({
      auth: stub,
      billDrafts: stub,
      catalogExport: stub,
      categories: stub,
      products: stub,
      sales: stub,
      settings: stub,
      shifts: service,
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

  beforeEach(() => {
    handlers.clear();
    kit = createCheckoutKit();
    sales = createSalesService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      stock: createStockService({ database: kit.database, audit: kit.audit }),
    });
    const stub = {} as never;
    registerIpcHandlers({
      auth: stub,
      billDrafts: kit.billDrafts,
      catalogExport: stub,
      categories: stub,
      products: stub,
      sales,
      settings: stub,
      shifts: kit.shifts,
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
    const complete = vi.spyOn(sales, "complete");

    await expect(invoke(channel, input)).rejects.toThrow();

    for (const spy of [...spies, complete]) expect(spy).not.toHaveBeenCalled();
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
