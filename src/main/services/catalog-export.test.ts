import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, SessionLockedError, UnauthenticatedError } from "../auth/errors";
import { createSessionStore, type SessionStore } from "../auth/session";
import { openDatabase, type VendoraDatabase } from "../db/client";
import { uuidv7 } from "../db/id";
import { runMigrations } from "../db/migrate";
import { categories, productBarcodes, products, stores, taxCategories, users } from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { catalogCsvColumns } from "./catalog-csv";
import { createCatalogExportService, writeCatalogCsv } from "./catalog-export";
import { normalizeSearchText } from "./search-text";

const BOM = "﻿";

function openMigrated(dir: string): VendoraDatabase {
  const database = openDatabase(join(dir, "vendora.db"));
  runMigrations(database, {
    migrationsFolder: join(process.cwd(), "drizzle"),
    backupDir: join(dir, "backups"),
  });
  seedStoreAndTerminal(database);
  return database;
}

describe("createCatalogExportService", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let storeId: string;
  let categoryId: string;
  let taxCategoryId: string;
  let outPath: string;
  let chooseSavePath: ReturnType<typeof vi.fn<(name: string) => Promise<string | null>>>;
  let service: ReturnType<typeof createCatalogExportService>;

  const signIn = (role: "owner" | "manager" | "cashier") => {
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
    sessions.start({ userId: user.id, role, storeId, loggedInAt: new Date() });
  };

  const addProduct = (overrides: Partial<typeof products.$inferInsert> & { nameEn: string }) => {
    const values = {
      storeId,
      categoryId,
      taxCategoryId,
      unit: "piece" as const,
      costPaisa: 100,
      salePricePaisa: 150,
      ...overrides,
    };
    return database.db
      .insert(products)
      .values({
        ...values,
        searchText: normalizeSearchText(values.nameEn, values.nameUr, values.internalCode),
      })
      .returning()
      .get();
  };

  const addBarcode = (
    productId: string,
    barcode: string,
    overrides: Partial<typeof productBarcodes.$inferInsert> = {},
  ) =>
    database.db
      .insert(productBarcodes)
      .values({ storeId, productId, barcode, ...overrides })
      .run();

  const exportRows = async (): Promise<string[][]> => {
    await service.exportCsv();
    const text = readFileSync(outPath, "utf8");
    expect(text.startsWith(BOM)).toBe(true);
    return text
      .slice(1)
      .split("\r\n")
      .filter((line) => line !== "")
      .map((line) => line.split(","));
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-catalog-export-"));
    database = openMigrated(dir);
    sessions = createSessionStore();
    storeId = database.db.select().from(stores).get()!.id;
    categoryId = database.db.select().from(categories).get()!.id;
    taxCategoryId = database.db.select().from(taxCategories).get()!.id;
    outPath = join(dir, "out.csv");
    chooseSavePath = vi.fn(async () => outPath);
    service = createCatalogExportService({
      database,
      sessions,
      chooseSavePath,
      now: () => new Date(2026, 0, 1, 10),
    });
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the header in column order", async () => {
    signIn("owner");
    const rows = await exportRows();
    expect(rows).toEqual([[...catalogCsvColumns]]);
  });

  it("writes a row per pack barcode, base unit first", async () => {
    signIn("owner");
    const tapal = addProduct({ nameEn: "Tapal Danedar 950g" });
    addBarcode(tapal.id, "8964000123473", { packQtyMilli: 24000, salePricePaisa: 3000000 });
    addBarcode(tapal.id, "8964000123459", { packQtyMilli: 1000 });
    const rows = (await exportRows()).slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.slice(2, 5)).toEqual(["8964000123459", "1", ""]);
    expect(rows[1]!.slice(2, 5)).toEqual(["8964000123473", "24", "30000.00"]);
  });

  it("writes one blank-barcode row for products without barcodes", async () => {
    signIn("owner");
    addProduct({ nameEn: "Sugar (loose)", unit: "kg", lowStockThresholdMilli: 2500 });
    const deleted = addProduct({ nameEn: "Salt" });
    addBarcode(deleted.id, "111", { deletedAt: new Date() });
    const rows = (await exportRows()).slice(1);
    expect(rows).toHaveLength(2);
    const sugar = rows.find((row) => row[0] === "Salt")!;
    expect(sugar.slice(2, 5)).toEqual(["", "", ""]);
    const loose = rows.find((row) => row[0] === "Sugar (loose)")!;
    expect(loose.slice(2, 5)).toEqual(["", "", ""]);
    expect(loose[6]).toBe("kg");
    expect(loose[14]).toBe("2.5");
  });

  it("applies the product filters", async () => {
    signIn("owner");
    addProduct({ nameEn: "Live" });
    addProduct({ nameEn: "Gone", deletedAt: new Date() });
    addProduct({ nameEn: "Builtin", isSystem: true });
    addProduct({ nameEn: "Old", isActive: false });
    const other = database.db.insert(stores).values({ name: "Other" }).returning().get();
    const otherCategory = database.db
      .insert(categories)
      .values({ storeId: other.id, name: "X" })
      .returning()
      .get();
    database.db
      .insert(products)
      .values({
        storeId: other.id,
        categoryId: otherCategory.id,
        taxCategoryId,
        nameEn: "Elsewhere",
        searchText: "elsewhere",
        unit: "piece",
        costPaisa: 1,
        salePricePaisa: 2,
      })
      .run();
    const rows = (await exportRows()).slice(1);
    expect(rows.map((row) => [row[0], row[15]])).toEqual([
      ["Live", "active"],
      ["Old", "archived"],
    ]);
  });

  it("writes category and tax category names", async () => {
    signIn("owner");
    addProduct({ nameEn: "Named" });
    const categoryName = database.db.select().from(categories).get()!.name;
    const taxName = database.db.select().from(taxCategories).get()!.name;
    const row = (await exportRows())[1]!;
    expect(row[5]).toBe(categoryName);
    expect(row[10]).toBe(taxName);
  });

  it("round-trips Urdu and escapes quoted names", async () => {
    signIn("owner");
    addProduct({ nameEn: 'Rice, "Super"', nameUr: "ٹپال دانے دار" });
    await service.exportCsv();
    const bytes = readFileSync(outPath);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = bytes.toString("utf8").slice(1).split("\r\n");
    expect(lines[1]!.startsWith('"Rice, ""Super""",ٹپال دانے دار,')).toBe(true);
  });

  it("saves for owner and manager with a dated default name", async () => {
    signIn("owner");
    expect(await service.exportCsv()).toEqual({ status: "saved", path: outPath });
    expect(chooseSavePath).toHaveBeenCalledWith("vendora-catalog-2026-01-01.csv");
    rmSync(outPath);
    sessions.end();
    signIn("manager");
    expect(await service.exportCsv()).toEqual({ status: "saved", path: outPath });
  });

  it("refuses a cashier before the dialog opens", async () => {
    signIn("cashier");
    await expect(service.exportCsv()).rejects.toBeInstanceOf(ForbiddenError);
    expect(chooseSavePath).not.toHaveBeenCalled();
  });

  it("refuses without a session or when locked", async () => {
    await expect(service.exportCsv()).rejects.toBeInstanceOf(UnauthenticatedError);
    signIn("owner");
    sessions.lock();
    await expect(service.exportCsv()).rejects.toBeInstanceOf(SessionLockedError);
    expect(chooseSavePath).not.toHaveBeenCalled();
  });

  it("returns cancelled and writes nothing", async () => {
    signIn("owner");
    chooseSavePath.mockResolvedValueOnce(null);
    expect(await service.exportCsv()).toEqual({ status: "cancelled" });
    expect(existsSync(outPath)).toBe(false);
  });

  it("refuses when the session locks during the dialog", async () => {
    signIn("owner");
    chooseSavePath.mockImplementationOnce(async () => {
      sessions.lock();
      return outPath;
    });
    await expect(service.exportCsv()).rejects.toBeInstanceOf(SessionLockedError);
    expect(existsSync(outPath)).toBe(false);
  });

  it("rejects and leaves no file when the write fails", async () => {
    signIn("owner");
    const missing = join(dir, "missing", "out.csv");
    chooseSavePath.mockResolvedValueOnce(missing);
    await expect(service.exportCsv()).rejects.toThrow();
    expect(existsSync(missing)).toBe(false);
  });
});

describe("writeCatalogCsv with 30,000 products", () => {
  const total = 30_000;
  const urduWords = ["چائے", "دودھ", "بسکٹ", "مصالحہ", "تیل", "صابن"];
  let dir: string;
  let database: VendoraDatabase;
  let storeId: string;
  let expectedRows = 0;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-catalog-export-bench-"));
    database = openMigrated(dir);
    storeId = database.db.select().from(stores).get()!.id;
    const categoryId = database.db.select().from(categories).get()!.id;
    const taxCategoryId = database.db.select().from(taxCategories).get()!.id;
    const insertProduct = database.sqlite.prepare(
      `INSERT INTO products (id, store_id, name_en, name_ur, search_text, category_id, tax_category_id, unit, internal_code, cost_paisa, sale_price_paisa, is_active, is_system, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'piece', ?, 100, 150, ?, 0, ?, ?)`,
    );
    const insertBarcode = database.sqlite.prepare(
      `INSERT INTO product_barcodes (id, store_id, product_id, barcode, pack_qty_milli, sale_price_paisa, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    database.sqlite.transaction(() => {
      for (let i = 0; i < total; i++) {
        const nameEn = `Product ${i}`;
        const nameUr = i % 3 === 0 ? `${urduWords[i % urduWords.length]} ${i}` : null;
        const productId = uuidv7();
        insertProduct.run(
          productId,
          storeId,
          nameEn,
          nameUr,
          normalizeSearchText(nameEn, nameUr, `C${i}`),
          categoryId,
          taxCategoryId,
          `C${i}`,
          i % 20 === 0 ? 0 : 1,
          now,
          now,
        );
        if (i % 25 === 0) {
          expectedRows += 1;
          continue;
        }
        insertBarcode.run(uuidv7(), storeId, productId, `B${i}`, 1000, null, now, now);
        expectedRows += 1;
        if (i % 10 === 0) {
          insertBarcode.run(uuidv7(), storeId, productId, `P${i}`, 12000, 1800, now, now);
          expectedRows += 1;
        }
      }
    })();
  }, 60_000);

  afterAll(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("finishes in under 5 seconds", async () => {
    const file = join(dir, "bench.csv");
    const started = performance.now();
    const rowCount = await writeCatalogCsv(database, storeId, file);
    const elapsed = performance.now() - started;
    console.log(`catalog export ${total} products: ${Math.round(elapsed)} ms`);
    expect(elapsed).toBeLessThan(5000);
    expect(rowCount).toBe(expectedRows);
    const lines = readFileSync(file, "utf8").split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(expectedRows + 1);
  });
});
