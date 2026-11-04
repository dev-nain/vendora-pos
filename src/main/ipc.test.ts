import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ipcErrorMessages } from "@shared/ipc";
import { createProductInputSchema } from "@shared/products";
import { createSessionStore, type SessionStore } from "./auth/session";
import { openDatabase, type VendoraDatabase } from "./db/client";
import { runMigrations } from "./db/migrate";
import {
  auditLog,
  categories,
  products,
  stores,
  taxCategories,
  users,
  type UserRole,
} from "./db/schema";
import { seedStoreAndTerminal } from "./db/seed";
import { registerIpcHandlers } from "./ipc";
import { createAuditService } from "./services/audit";
import { createCatalogExportService } from "./services/catalog-export";
import { createProductsService, type ProductsService } from "./services/products";

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

  const signIn = (role: UserRole) => {
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
      catalogExport,
      categories: stub,
      products: service,
      settings: stub,
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

  describe("cashier", () => {
    it("is forbidden on every write and nothing changes", async () => {
      const product = seedProduct();
      signIn("cashier");
      const before = counts();
      const writes: [string, unknown][] = [
        ["products:create", draft({ barcodes: [] })],
        ["products:update", { ...draft(), id: product.id }],
        ["products:archive", { id: product.id }],
        ["products:restore", { id: product.id }],
        ["products:delete", { id: product.id }],
        ["products:bulk-update", { productIds: [product.id], change: bulkPrice }],
      ];
      for (const [channel, input] of writes) {
        await expect(invoke(channel, input)).rejects.toThrow(new Error(ipcErrorMessages.forbidden));
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

    it("is forbidden for a cashier", async () => {
      signIn("cashier");
      await expect(invoke("products:export-csv")).rejects.toThrow(
        new Error(ipcErrorMessages.forbidden),
      );
      expect(existsSync(join(dir, "catalog.csv"))).toBe(false);
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
