import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type VendoraDatabase } from "./client";
import { runMigrations } from "./migrate";
import {
  categories,
  productBarcodes,
  products,
  stores,
  taxCategories,
  users,
  type ProductUnit,
} from "./schema";

const migrationsFolder = join(process.cwd(), "drizzle");

const newUser = (username: string) => ({
  username,
  displayName: "Name",
  passwordHash: "hash",
  pinHash: "hash",
});

describe("auth schema migration", () => {
  let dir: string;
  let backupDir: string;
  let database: VendoraDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-schema-"));
    backupDir = join(dir, "backups");
    database = openDatabase(join(dir, "vendora.db"));
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const migrate = () => runMigrations(database, { migrationsFolder, backupDir });
  const tableNames = () =>
    database.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);

  it("creates the four tables on a fresh database without a backup", () => {
    expect(migrate()).toBe("migrated");
    expect(tableNames()).toEqual(
      expect.arrayContaining(["stores", "terminals", "users", "audit_log"]),
    );
    expect(existsSync(backupDir)).toBe(false);
  });

  it("backs up and keeps existing data when the database already has tables", () => {
    database.sqlite.exec("CREATE TABLE scratch (x INTEGER); INSERT INTO scratch VALUES (1);");

    expect(migrate()).toBe("migrated");

    const backups = readdirSync(backupDir).filter((f) => /^pre-migrate-.*\.db$/.test(f));
    expect(backups).toHaveLength(1);
    expect(database.sqlite.prepare("SELECT x FROM scratch").all()).toEqual([{ x: 1 }]);

    const backup = openDatabase(join(backupDir, backups[0] ?? ""));
    try {
      expect(backup.sqlite.prepare("SELECT x FROM scratch").all()).toEqual([{ x: 1 }]);
    } finally {
      backup.sqlite.close();
    }
  });

  it("is up to date on the second run", () => {
    migrate();
    expect(migrate()).toBe("up-to-date");
  });

  it("rejects a username that differs only by case", () => {
    migrate();
    database.db.insert(users).values(newUser("owner")).run();
    expect(() => database.db.insert(users).values(newUser("Owner")).run()).toThrow();
  });

  it("uses no SQLite-only constructs", () => {
    const files = readdirSync(migrationsFolder).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(1);
    const sqlText = files.map((f) => readFileSync(join(migrationsFolder, f), "utf8")).join("\n");
    for (const banned of [
      /AUTOINCREMENT/i,
      /COLLATE\s+NOCASE/i,
      /unixepoch/i,
      /\bSTRICT\b/i,
      /WITHOUT\s+ROWID/i,
    ]) {
      expect(sqlText).not.toMatch(banned);
    }
  });
});

describe("catalog schema", () => {
  let dir: string;
  let database: VendoraDatabase;
  let storeId: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-catalog-"));
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, { migrationsFolder, backupDir: join(dir, "backups") });
    storeId = database.db.insert(stores).values({}).returning().get().id;
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const otherStoreId = () => database.db.insert(stores).values({}).returning().get().id;

  it("rejects a category name that differs only by case, until the first is soft-deleted", () => {
    const first = database.db
      .insert(categories)
      .values({ storeId, name: "General" })
      .returning()
      .get();
    expect(() =>
      database.db.insert(categories).values({ storeId, name: "general" }).run(),
    ).toThrow();

    database.db
      .update(categories)
      .set({ deletedAt: new Date() })
      .where(eq(categories.id, first.id))
      .run();
    database.db.insert(categories).values({ storeId, name: "general" }).run();
  });

  it("rejects a tax category name that differs only by case, until the first is soft-deleted", () => {
    const first = database.db
      .insert(taxCategories)
      .values({ storeId, name: "Standard" })
      .returning()
      .get();
    expect(() =>
      database.db.insert(taxCategories).values({ storeId, name: "STANDARD" }).run(),
    ).toThrow();

    database.db
      .update(taxCategories)
      .set({ deletedAt: new Date() })
      .where(eq(taxCategories.id, first.id))
      .run();
    database.db.insert(taxCategories).values({ storeId, name: "STANDARD" }).run();
  });

  it("allows the same name in another store", () => {
    const other = otherStoreId();
    database.db.insert(categories).values({ storeId, name: "General" }).run();
    database.db.insert(categories).values({ storeId: other, name: "General" }).run();
    database.db.insert(taxCategories).values({ storeId, name: "Exempt", rateBps: 0 }).run();
    database.db.insert(taxCategories).values({ storeId: other, name: "Exempt", rateBps: 0 }).run();
  });

  it("limits tax category rate_bps to 0-10000 or null", () => {
    const insert = (name: string, rateBps: number | null) =>
      database.db.insert(taxCategories).values({ storeId, name, rateBps }).run();

    expect(() => insert("a", -1)).toThrow();
    expect(() => insert("b", 10001)).toThrow();
    for (const [name, rate] of [
      ["c", 0],
      ["d", 10000],
      ["e", null],
    ] as const) {
      insert(name, rate);
    }
    expect(database.db.select().from(taxCategories).all()).toHaveLength(3);
  });

  it("defaults the store standard tax rate to 1800 and limits it to 0-10000", () => {
    expect(database.db.select().from(stores).get()?.standardTaxRateBps).toBe(1800);
    for (const rate of [-1, 10001]) {
      expect(() => database.db.insert(stores).values({ standardTaxRateBps: rate }).run()).toThrow();
    }
  });
});

describe("product schema", () => {
  let dir: string;
  let database: VendoraDatabase;
  let storeId: string;
  let categoryId: string;
  let taxCategoryId: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-products-"));
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, { migrationsFolder, backupDir: join(dir, "backups") });
    storeId = database.db.insert(stores).values({}).returning().get().id;
    categoryId = database.db
      .insert(categories)
      .values({ storeId, name: "General" })
      .returning()
      .get().id;
    taxCategoryId = database.db
      .insert(taxCategories)
      .values({ storeId, name: "Standard" })
      .returning()
      .get().id;
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const newProduct = (overrides: Partial<typeof products.$inferInsert> = {}) => ({
    storeId,
    nameEn: "Tea",
    searchText: "tea",
    categoryId,
    taxCategoryId,
    unit: "piece" as ProductUnit,
    costPaisa: 10000,
    salePricePaisa: 12000,
    ...overrides,
  });
  const insertProduct = (overrides: Partial<typeof products.$inferInsert> = {}) =>
    database.db.insert(products).values(newProduct(overrides)).returning().get();
  const newBarcode = (
    productId: string,
    overrides: Partial<typeof productBarcodes.$inferInsert> = {},
  ) => ({ storeId, productId, barcode: "8961000000017", ...overrides });
  const insertBarcode = (
    productId: string,
    overrides: Partial<typeof productBarcodes.$inferInsert> = {},
  ) =>
    database.db.insert(productBarcodes).values(newBarcode(productId, overrides)).returning().get();
  const otherStoreId = () => database.db.insert(stores).values({}).returning().get().id;

  it("applies defaults and leaves optional fields null", () => {
    const product = insertProduct();
    expect(product.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(product).toMatchObject({
      isActive: true,
      isSystem: false,
      nameUr: null,
      brand: null,
      internalCode: null,
      mrpPaisa: null,
      pctCode: null,
      lowStockThresholdMilli: null,
      deletedAt: null,
    });
    const barcode = insertBarcode(product.id);
    expect(barcode).toMatchObject({ packQtyMilli: 1000, salePricePaisa: null, deletedAt: null });
  });

  it("accepts piece, kg and litre and rejects other units", () => {
    for (const unit of ["piece", "kg", "litre"] as const) {
      insertProduct({ unit });
    }
    for (const unit of ["g", "ml", "pcs"]) {
      expect(() => insertProduct({ unit: unit as ProductUnit })).toThrow();
    }
  });

  it("rejects negative money and accepts zero", () => {
    expect(() => insertProduct({ costPaisa: -1 })).toThrow();
    expect(() => insertProduct({ salePricePaisa: -1 })).toThrow();
    expect(() => insertProduct({ mrpPaisa: -1 })).toThrow();
    const product = insertProduct({ costPaisa: 0, salePricePaisa: 0, mrpPaisa: 0 });
    expect(() => insertBarcode(product.id, { salePricePaisa: -1 })).toThrow();
    expect(insertBarcode(product.id, { salePricePaisa: 0 }).salePricePaisa).toBe(0);
  });

  it("requires a positive pack quantity and stores a pack price", () => {
    const product = insertProduct();
    expect(() => insertBarcode(product.id, { packQtyMilli: 0 })).toThrow();
    expect(() => insertBarcode(product.id, { packQtyMilli: -1000 })).toThrow();
    const pack = insertBarcode(product.id, { packQtyMilli: 24000, salePricePaisa: 270000 });
    expect(pack).toMatchObject({ packQtyMilli: 24000, salePricePaisa: 270000 });
  });

  it("rejects a duplicate active barcode in a store until soft-deleted", () => {
    const first = insertProduct();
    const second = insertProduct({ nameEn: "Sugar", searchText: "sugar" });
    const original = insertBarcode(first.id);
    expect(() => insertBarcode(first.id)).toThrow();
    expect(() => insertBarcode(second.id)).toThrow();

    const other = otherStoreId();
    const otherCategory = database.db
      .insert(categories)
      .values({ storeId: other, name: "General" })
      .returning()
      .get().id;
    const otherTax = database.db
      .insert(taxCategories)
      .values({ storeId: other, name: "Standard" })
      .returning()
      .get().id;
    const otherProduct = insertProduct({
      storeId: other,
      categoryId: otherCategory,
      taxCategoryId: otherTax,
    });
    insertBarcode(otherProduct.id, { storeId: other });

    database.db
      .update(productBarcodes)
      .set({ deletedAt: new Date() })
      .where(eq(productBarcodes.id, original.id))
      .run();
    insertBarcode(second.id);
  });

  it("rejects a duplicate active internal code until soft-deleted and allows several nulls", () => {
    const first = insertProduct({ internalCode: "A1" });
    expect(() => insertProduct({ internalCode: "A1" })).toThrow();
    database.db
      .update(products)
      .set({ deletedAt: new Date() })
      .where(eq(products.id, first.id))
      .run();
    insertProduct({ internalCode: "A1" });
    insertProduct({ internalCode: null });
    insertProduct({ internalCode: null });
  });

  it("rejects unknown category, tax category and product references", () => {
    expect(() => insertProduct({ categoryId: "missing" })).toThrow();
    expect(() => insertProduct({ taxCategoryId: "missing" })).toThrow();
    expect(() => insertBarcode("missing")).toThrow();
  });

  const planDetail = (query: string, ...params: string[]) =>
    database.sqlite
      .prepare(`EXPLAIN QUERY PLAN ${query}`)
      .all(...params)
      .map((row) => (row as { detail: string }).detail)
      .join("\n");

  it("looks up barcodes, internal codes and search prefixes through their indexes", () => {
    expect(
      planDetail(
        "SELECT id FROM product_barcodes WHERE store_id = ? AND barcode = ? AND deleted_at IS NULL",
        storeId,
        "8961000000017",
      ),
    ).toContain("product_barcodes_store_id_barcode_unique");
    expect(
      planDetail(
        "SELECT id FROM products WHERE store_id = ? AND internal_code = ? AND deleted_at IS NULL",
        storeId,
        "A1",
      ),
    ).toContain("products_store_id_internal_code_unique");
    expect(
      planDetail(
        "SELECT id FROM products WHERE store_id = ? AND search_text >= ? AND search_text < ?",
        storeId,
        "te",
        "tf",
      ),
    ).toContain("products_store_id_search_text_idx");
  });
});

describe("catalog migration on an existing database", () => {
  it("backs up, keeps the store and adds the default tax rate", () => {
    const dir = mkdtempSync(join(tmpdir(), "vendora-upgrade-"));
    const database = openDatabase(join(dir, "vendora.db"));
    try {
      const oldFolder = join(dir, "old-migrations");
      mkdirSync(join(oldFolder, "meta"), { recursive: true });
      const journal = JSON.parse(
        readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
      ) as { entries: { tag: string }[] };
      journal.entries = journal.entries.slice(0, 3);
      writeFileSync(join(oldFolder, "meta", "_journal.json"), JSON.stringify(journal));
      for (const entry of journal.entries) {
        copyFileSync(
          join(migrationsFolder, `${entry.tag}.sql`),
          join(oldFolder, `${entry.tag}.sql`),
        );
      }

      const backupDir = join(dir, "backups");
      runMigrations(database, { migrationsFolder: oldFolder, backupDir });
      database.sqlite.exec(
        "INSERT INTO stores (id, name, created_at, updated_at) VALUES ('s1', 'Existing', 0, 0)",
      );

      expect(runMigrations(database, { migrationsFolder, backupDir })).toBe("migrated");

      expect(readdirSync(backupDir).filter((f) => /^pre-migrate-.*\.db$/.test(f))).toHaveLength(1);
      expect(
        database.sqlite.prepare("SELECT name, standard_tax_rate_bps AS rate FROM stores").all(),
      ).toEqual([{ name: "Existing", rate: 1800 }]);
      const tables = database.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(tables).toEqual(expect.arrayContaining(["categories", "tax_categories"]));
    } finally {
      database.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("product migration on an existing database", () => {
  it("backs up, keeps existing rows and adds the product tables", () => {
    const dir = mkdtempSync(join(tmpdir(), "vendora-upgrade-"));
    const database = openDatabase(join(dir, "vendora.db"));
    try {
      const oldFolder = join(dir, "old-migrations");
      mkdirSync(join(oldFolder, "meta"), { recursive: true });
      const journal = JSON.parse(
        readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
      ) as { entries: { tag: string }[] };
      journal.entries = journal.entries.slice(0, 4);
      writeFileSync(join(oldFolder, "meta", "_journal.json"), JSON.stringify(journal));
      for (const entry of journal.entries) {
        copyFileSync(
          join(migrationsFolder, `${entry.tag}.sql`),
          join(oldFolder, `${entry.tag}.sql`),
        );
      }

      const backupDir = join(dir, "backups");
      runMigrations(database, { migrationsFolder: oldFolder, backupDir });
      database.sqlite.exec(
        "INSERT INTO stores (id, name, created_at, updated_at) VALUES ('s1', 'Existing', 0, 0)",
      );
      database.sqlite.exec(
        "INSERT INTO categories (id, store_id, name, created_at, updated_at) VALUES ('c1', 's1', 'General', 0, 0)",
      );
      database.sqlite.exec(
        "INSERT INTO tax_categories (id, store_id, name, rate_bps, created_at, updated_at) VALUES ('t1', 's1', 'Standard', NULL, 0, 0)",
      );

      expect(runMigrations(database, { migrationsFolder, backupDir })).toBe("migrated");

      expect(readdirSync(backupDir).filter((f) => /^pre-migrate-.*\.db$/.test(f))).toHaveLength(1);
      expect(database.sqlite.prepare("SELECT id, name FROM stores").all()).toEqual([
        { id: "s1", name: "Existing" },
      ]);
      expect(database.sqlite.prepare("SELECT id, name FROM categories").all()).toEqual([
        { id: "c1", name: "General" },
      ]);
      expect(database.sqlite.prepare("SELECT id, name FROM tax_categories").all()).toEqual([
        { id: "t1", name: "Standard" },
      ]);
      const tables = database.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(tables).toEqual(expect.arrayContaining(["products", "product_barcodes"]));
      expect(database.sqlite.prepare("SELECT is_system AS s FROM categories").all()).toEqual([
        { s: 0 },
      ]);
      expect(database.sqlite.prepare("SELECT is_system AS s FROM tax_categories").all()).toEqual([
        { s: 0 },
      ]);
    } finally {
      database.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const seedScaleStore = () => {
  const dir = mkdtempSync(join(tmpdir(), "vendora-scale-"));
  const database = openDatabase(join(dir, "vendora.db"));
  runMigrations(database, { migrationsFolder, backupDir: join(dir, "backups") });
  database.sqlite.exec(
    "INSERT INTO stores (id, name, created_at, updated_at) VALUES ('s1', 'Store', 0, 0)",
  );
  return { dir, database };
};

describe("scale prefix settings", () => {
  it("defaults a fresh store to 21 and 22", () => {
    const { dir, database } = seedScaleStore();
    try {
      expect(
        database.sqlite
          .prepare("SELECT scale_weight_prefix AS w, scale_price_prefix AS p FROM stores")
          .get(),
      ).toEqual({ w: "21", p: "22" });
    } finally {
      database.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(["scale_weight_prefix", "scale_price_prefix"])("enforces two digits on %s", (column) => {
    const { dir, database } = seedScaleStore();
    try {
      for (const bad of ["'2'", "'210'", "'2a'", "'ab'", "NULL"]) {
        expect(() => database.sqlite.exec(`UPDATE stores SET ${column} = ${bad}`)).toThrow();
      }
      database.sqlite.exec(`UPDATE stores SET ${column} = '02'`);
      expect(database.sqlite.prepare(`SELECT ${column} AS v FROM stores`).get()).toEqual({
        v: "02",
      });
    } finally {
      database.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds the columns without rebuilding the stores table", () => {
    const sql = readFileSync(join(migrationsFolder, "0005_scale_barcode_prefixes.sql"), "utf8");
    expect(sql).not.toContain("__new_stores");
  });

  it("backs up, keeps the store and fills in the defaults on upgrade", () => {
    const dir = mkdtempSync(join(tmpdir(), "vendora-upgrade-"));
    const database = openDatabase(join(dir, "vendora.db"));
    try {
      const oldFolder = join(dir, "old-migrations");
      mkdirSync(join(oldFolder, "meta"), { recursive: true });
      const journal = JSON.parse(
        readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
      ) as { entries: { tag: string }[] };
      journal.entries = journal.entries.slice(0, 5);
      writeFileSync(join(oldFolder, "meta", "_journal.json"), JSON.stringify(journal));
      for (const entry of journal.entries) {
        copyFileSync(
          join(migrationsFolder, `${entry.tag}.sql`),
          join(oldFolder, `${entry.tag}.sql`),
        );
      }

      const backupDir = join(dir, "backups");
      runMigrations(database, { migrationsFolder: oldFolder, backupDir });
      database.sqlite.exec(
        "INSERT INTO stores (id, name, created_at, updated_at) VALUES ('s1', 'Existing', 0, 0)",
      );

      expect(runMigrations(database, { migrationsFolder, backupDir })).toBe("migrated");

      expect(readdirSync(backupDir).filter((f) => /^pre-migrate-.*\.db$/.test(f))).toHaveLength(1);
      expect(
        database.sqlite
          .prepare("SELECT name, scale_weight_prefix AS w, scale_price_prefix AS p FROM stores")
          .all(),
      ).toEqual([{ name: "Existing", w: "21", p: "22" }]);
    } finally {
      database.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const columnsOf = (database: VendoraDatabase, table: string) =>
  database.sqlite
    .prepare(`SELECT name FROM pragma_table_info('${table}')`)
    .all()
    .map((row) => (row as { name: string }).name);

const tableSql = (database: VendoraDatabase, table: string) =>
  (
    database.sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { sql: string }
  ).sql;

const indexNames = (database: VendoraDatabase, table: string) =>
  database.sqlite
    .prepare(`SELECT name FROM pragma_index_list('${table}')`)
    .all()
    .map((row) => (row as { name: string }).name);

describe("remove roles and lock migration on an existing database", () => {
  it("keeps every row and constraint while dropping roles, the discount limit, auto-lock and the approver", () => {
    const dir = mkdtempSync(join(tmpdir(), "vendora-upgrade-"));
    const database = openDatabase(join(dir, "vendora.db"));
    try {
      const oldFolder = join(dir, "old-migrations");
      mkdirSync(join(oldFolder, "meta"), { recursive: true });
      const journal = JSON.parse(
        readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
      ) as { entries: { tag: string }[] };
      journal.entries = journal.entries.slice(0, 8);
      writeFileSync(join(oldFolder, "meta", "_journal.json"), JSON.stringify(journal));
      for (const entry of journal.entries) {
        copyFileSync(
          join(migrationsFolder, `${entry.tag}.sql`),
          join(oldFolder, `${entry.tag}.sql`),
        );
      }

      const backupDir = join(dir, "backups");
      runMigrations(database, { migrationsFolder: oldFolder, backupDir });
      expect(database.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);

      database.sqlite.exec(`
        INSERT INTO stores (id, name, cashier_discount_limit_bps, auto_lock_minutes, standard_tax_rate_bps, scale_weight_prefix, scale_price_prefix, misc_item_enabled, created_at, updated_at)
          VALUES ('s1', 'Old', 900, 10, 1500, '02', '29', 1, 11, 12);
        INSERT INTO terminals (id, store_id, code, created_at, updated_at) VALUES ('t1', 's1', 'T1', 1, 2);
        INSERT INTO categories (id, store_id, name, created_at, updated_at) VALUES ('c1', 's1', 'Tea', 1, 2);
        INSERT INTO tax_categories (id, store_id, name, rate_bps, created_at, updated_at) VALUES ('x1', 's1', 'Reduced', 500, 1, 2);
        INSERT INTO products (id, store_id, name_en, search_text, category_id, tax_category_id, unit, cost_paisa, sale_price_paisa, created_at, updated_at)
          VALUES ('p1', 's1', 'Tapal', 'tapal', 'c1', 'x1', 'piece', 100, 150, 1, 2);
        INSERT INTO product_barcodes (id, store_id, product_id, barcode, created_at, updated_at) VALUES ('b1', 's1', 'p1', '123', 1, 2);
        INSERT INTO users (id, username, display_name, role, password_hash, pin_hash, failed_pin_attempts, pin_retry_after, is_active, deleted_at, created_at, updated_at)
          VALUES ('u1', 'Owner', 'Imran', 'owner', 'p1', 'q1', 0, NULL, 1, NULL, 1, 2),
                 ('u2', 'manager', 'Sana', 'manager', 'p2', 'q2', 3, 99, 1, NULL, 3, 4),
                 ('u3', 'cashier', 'Bilal', 'cashier', 'p3', 'q3', 0, NULL, 0, NULL, 5, 6);
        INSERT INTO audit_log (id, store_id, terminal_id, actor_user_id, approver_user_id, action, entity_type, entity_id, details, created_at) VALUES
          ('a1', 's1', 't1', 'u1', NULL, 'login', NULL, NULL, '{"method":"password"}', 1),
          ('a2', 's1', 't1', 'u2', 'u1', 'override', 'sale', 'z', '{"role":"manager"}', 2),
          ('a3', 's1', 't1', 'u3', NULL, 'logout', NULL, NULL, NULL, 3);
      `);

      expect(runMigrations(database, { migrationsFolder, backupDir })).toBe("migrated");

      expect(readdirSync(backupDir).filter((f) => /^pre-migrate-.*\.db$/.test(f))).toHaveLength(1);
      expect(database.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(database.sqlite.pragma("foreign_key_check")).toEqual([]);

      expect(columnsOf(database, "stores")).toEqual([
        "id",
        "name",
        "standard_tax_rate_bps",
        "scale_weight_prefix",
        "scale_price_prefix",
        "misc_item_enabled",
        "shift_variance_warn_paisa",
        "prices_include_tax",
        "cash_rounding_enabled",
        "cash_rounding_paisa",
        "cash_rounding_cash_only",
        "created_at",
        "updated_at",
        "address",
        "phone",
        "ntn",
        "strn",
        "receipt_header_en",
        "receipt_header_ur",
        "receipt_footer_en",
        "receipt_footer_ur",
      ]);
      expect(columnsOf(database, "users")).not.toContain("role");
      expect(columnsOf(database, "audit_log")).not.toContain("approver_user_id");

      expect(database.sqlite.prepare("SELECT * FROM stores").all()).toEqual([
        {
          id: "s1",
          name: "Old",
          standard_tax_rate_bps: 1500,
          scale_weight_prefix: "02",
          scale_price_prefix: "29",
          misc_item_enabled: 1,
          created_at: 11,
          updated_at: 12,
          shift_variance_warn_paisa: 0,
          prices_include_tax: 1,
          cash_rounding_enabled: 0,
          cash_rounding_paisa: 100,
          cash_rounding_cash_only: 1,
          address: null,
          phone: null,
          ntn: null,
          strn: null,
          receipt_header_en: null,
          receipt_header_ur: null,
          receipt_footer_en: null,
          receipt_footer_ur: null,
        },
      ]);
      expect(database.sqlite.prepare("SELECT * FROM users ORDER BY id").all()).toEqual([
        {
          id: "u1",
          username: "Owner",
          display_name: "Imran",
          password_hash: "p1",
          pin_hash: "q1",
          failed_pin_attempts: 0,
          pin_retry_after: null,
          is_active: 1,
          deleted_at: null,
          created_at: 1,
          updated_at: 2,
        },
        {
          id: "u2",
          username: "manager",
          display_name: "Sana",
          password_hash: "p2",
          pin_hash: "q2",
          failed_pin_attempts: 3,
          pin_retry_after: 99,
          is_active: 1,
          deleted_at: null,
          created_at: 3,
          updated_at: 4,
        },
        {
          id: "u3",
          username: "cashier",
          display_name: "Bilal",
          password_hash: "p3",
          pin_hash: "q3",
          failed_pin_attempts: 0,
          pin_retry_after: null,
          is_active: 0,
          deleted_at: null,
          created_at: 5,
          updated_at: 6,
        },
      ]);
      expect(database.sqlite.prepare("SELECT * FROM audit_log ORDER BY id").all()).toEqual([
        {
          id: "a1",
          store_id: "s1",
          terminal_id: "t1",
          actor_user_id: "u1",
          action: "login",
          entity_type: null,
          entity_id: null,
          details: '{"method":"password"}',
          created_at: 1,
        },
        {
          id: "a2",
          store_id: "s1",
          terminal_id: "t1",
          actor_user_id: "u2",
          action: "override",
          entity_type: "sale",
          entity_id: "z",
          details: '{"role":"manager"}',
          created_at: 2,
        },
        {
          id: "a3",
          store_id: "s1",
          terminal_id: "t1",
          actor_user_id: "u3",
          action: "logout",
          entity_type: null,
          entity_id: null,
          details: null,
          created_at: 3,
        },
      ]);
      for (const [table, count] of [
        ["terminals", 1],
        ["categories", 1],
        ["tax_categories", 1],
        ["products", 1],
        ["product_barcodes", 1],
      ] as const) {
        expect(database.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({
          n: count,
        });
      }

      expect(() =>
        database.sqlite.exec(
          "INSERT INTO users (id, username, display_name, password_hash, pin_hash, created_at, updated_at) VALUES ('u4', 'MANAGER', 'Dup', 'p', 'q', 1, 2)",
        ),
      ).toThrow();

      database.sqlite.exec(
        "INSERT INTO stores (id, created_at, updated_at) VALUES ('s2', 1, 2); INSERT INTO users (id, username, display_name, password_hash, pin_hash, created_at, updated_at) VALUES ('u5', 'fresh', 'Fresh', 'p', 'q', 1, 2)",
      );
      expect(
        database.sqlite
          .prepare(
            "SELECT standard_tax_rate_bps AS rate, scale_weight_prefix AS w, scale_price_prefix AS p, misc_item_enabled AS misc FROM stores WHERE id = 's2'",
          )
          .get(),
      ).toEqual({ rate: 1800, w: "21", p: "22", misc: 0 });
      expect(
        database.sqlite
          .prepare(
            "SELECT is_active AS active, failed_pin_attempts AS failed FROM users WHERE id = 'u5'",
          )
          .get(),
      ).toEqual({ active: 1, failed: 0 });

      const storesSql = tableSql(database, "stores");
      for (const name of [
        "stores_standard_tax_rate_bps_check",
        "stores_scale_weight_prefix_check",
        "stores_scale_price_prefix_check",
      ]) {
        expect(storesSql).toContain(name);
      }
      expect(() =>
        database.sqlite.exec("UPDATE stores SET standard_tax_rate_bps = 10001"),
      ).toThrow();
      expect(() => database.sqlite.exec("UPDATE stores SET scale_weight_prefix = '2'")).toThrow();
      expect(() => database.sqlite.exec("UPDATE stores SET scale_price_prefix = '2a'")).toThrow();
      expect(() => database.sqlite.exec("UPDATE tax_categories SET rate_bps = 10001")).toThrow();

      expect(indexNames(database, "users")).toContain("users_username_lower_unique");
      expect(indexNames(database, "audit_log")).toEqual(
        expect.arrayContaining([
          "audit_log_created_at_idx",
          "audit_log_actor_created_at_idx",
          "audit_log_action_created_at_idx",
        ]),
      );
      expect(
        database.sqlite
          .prepare("SELECT \"table\" AS t FROM pragma_foreign_key_list('audit_log') ORDER BY 1")
          .all(),
      ).toEqual([{ t: "stores" }, { t: "terminals" }, { t: "users" }]);
      expect(
        database.sqlite
          .prepare("SELECT \"table\" AS t FROM pragma_foreign_key_list('terminals')")
          .all(),
      ).toEqual([{ t: "stores" }]);
      expect(
        database.sqlite
          .prepare("SELECT \"table\" AS t FROM pragma_foreign_key_list('products') ORDER BY 1")
          .all(),
      ).toEqual([{ t: "categories" }, { t: "stores" }, { t: "tax_categories" }]);
    } finally {
      database.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("shift schema", () => {
  let dir: string;
  let database: VendoraDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-shifts-"));
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, { migrationsFolder, backupDir: join(dir, "backups") });
    database.sqlite.exec(`
      INSERT INTO stores (id, created_at, updated_at) VALUES ('s1', 1, 1);
      INSERT INTO terminals (id, store_id, code, created_at, updated_at) VALUES ('t1', 's1', 'T1', 1, 1);
      INSERT INTO users (id, username, display_name, password_hash, pin_hash, created_at, updated_at)
        VALUES ('u1', 'bilal', 'Bilal', 'h', 'h', 1, 1);
    `);
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const openShift = (id: string, float = 0) =>
    database.sqlite.exec(
      `INSERT INTO shifts (id, store_id, terminal_id, opened_by, opened_at, opening_float_paisa, created_at, updated_at)
       VALUES ('${id}', 's1', 't1', 'u1', 1, ${float}, 1, 1)`,
    );

  const insertMove = (kind: string, amount: number) =>
    database.sqlite.exec(
      `INSERT INTO shift_cash_moves (id, store_id, terminal_id, shift_id, kind, amount_paisa, reason, created_by, created_at, updated_at)
       VALUES ('m${kind}${amount}', 's1', 't1', 'sh1', '${kind}', ${amount}, 'x', 'u1', 1, 1)`,
    );

  it("creates the four tables and defaults the variance warning to 0", () => {
    const names = database.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(names).toEqual(
      expect.arrayContaining([
        "cash_denominations",
        "shifts",
        "shift_cash_moves",
        "shift_cash_counts",
      ]),
    );
    expect(
      database.sqlite.prepare("SELECT shift_variance_warn_paisa AS v FROM stores").get(),
    ).toEqual({ v: 0 });
  });

  it("adds the column without rebuilding the stores table", () => {
    const sqlText = readFileSync(join(migrationsFolder, "0009_shifts.sql"), "utf8");
    expect(sqlText).not.toContain("__new_stores");
    expect(sqlText).toContain("ALTER TABLE `stores` ADD `shift_variance_warn_paisa`");
  });

  it("allows one open shift per terminal and a new one after it closes", () => {
    openShift("sh1");
    expect(() => openShift("sh2")).toThrow();
    database.sqlite.exec("UPDATE shifts SET closed_at = 2, closed_by = 'u1' WHERE id = 'sh1'");
    expect(() => openShift("sh2")).not.toThrow();
  });

  it("rejects a negative float, bad move amounts and kinds, and a half-set close", () => {
    expect(() => openShift("neg", -1)).toThrow();
    openShift("sh1");
    expect(() => insertMove("in", 0)).toThrow();
    expect(() => insertMove("out", -5)).toThrow();
    expect(() => insertMove("sideways", 5)).toThrow();
    expect(() => insertMove("in", 500)).not.toThrow();
    expect(() =>
      database.sqlite.exec("UPDATE shifts SET closed_at = 2 WHERE id = 'sh1'"),
    ).toThrow();
  });

  it("upgrades from 0008, backing up and keeping the store, users and audit rows", () => {
    const upgradeDir = mkdtempSync(join(tmpdir(), "vendora-upgrade-"));
    const old = openDatabase(join(upgradeDir, "vendora.db"));
    try {
      const oldFolder = join(upgradeDir, "old-migrations");
      mkdirSync(join(oldFolder, "meta"), { recursive: true });
      const journal = JSON.parse(
        readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
      ) as { entries: { tag: string }[] };
      journal.entries = journal.entries.slice(0, 9);
      writeFileSync(join(oldFolder, "meta", "_journal.json"), JSON.stringify(journal));
      for (const entry of journal.entries) {
        copyFileSync(
          join(migrationsFolder, `${entry.tag}.sql`),
          join(oldFolder, `${entry.tag}.sql`),
        );
      }
      const backupDir = join(upgradeDir, "backups");
      runMigrations(old, { migrationsFolder: oldFolder, backupDir });
      old.sqlite.exec(`
        INSERT INTO stores (id, name, created_at, updated_at) VALUES ('s1', 'Existing', 1, 1);
        INSERT INTO terminals (id, store_id, code, created_at, updated_at) VALUES ('t1', 's1', 'T1', 1, 1);
        INSERT INTO users (id, username, display_name, password_hash, pin_hash, created_at, updated_at)
          VALUES ('u1', 'bilal', 'Bilal', 'h', 'h', 1, 1);
        INSERT INTO audit_log (id, store_id, terminal_id, actor_user_id, action, created_at)
          VALUES ('a1', 's1', 't1', 'u1', 'login', 1);
      `);

      expect(runMigrations(old, { migrationsFolder, backupDir })).toBe("migrated");

      expect(readdirSync(backupDir).filter((f) => /^pre-migrate-.*\.db$/.test(f))).toHaveLength(1);
      expect(old.sqlite.pragma("foreign_key_check")).toEqual([]);
      expect(
        old.sqlite.prepare("SELECT name, shift_variance_warn_paisa AS v FROM stores").all(),
      ).toEqual([{ name: "Existing", v: 0 }]);
      expect(old.sqlite.prepare("SELECT count(*) AS n FROM users").get()).toEqual({ n: 1 });
      expect(old.sqlite.prepare("SELECT count(*) AS n FROM audit_log").get()).toEqual({ n: 1 });
    } finally {
      old.sqlite.close();
      rmSync(upgradeDir, { recursive: true, force: true });
    }
  });
});

describe("stock movement schema", () => {
  let dir: string;
  let database: VendoraDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-stock-schema-"));
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, { migrationsFolder, backupDir: join(dir, "backups") });
    database.sqlite.exec(`
      INSERT INTO stores (id, created_at, updated_at) VALUES ('s1', 1, 2);
      INSERT INTO terminals (id, store_id, code, created_at, updated_at) VALUES ('t1', 's1', 'T1', 1, 2);
      INSERT INTO users (id, username, display_name, password_hash, pin_hash, created_at, updated_at) VALUES ('u1', 'owner', 'Owner', 'p', 'q', 1, 2);
      INSERT INTO categories (id, store_id, name, created_at, updated_at) VALUES ('c1', 's1', 'Tea', 1, 2);
      INSERT INTO tax_categories (id, store_id, name, rate_bps, created_at, updated_at) VALUES ('x1', 's1', 'Standard', 1800, 1, 2);
      INSERT INTO products (id, store_id, name_en, search_text, category_id, tax_category_id, unit, cost_paisa, sale_price_paisa, created_at, updated_at)
        VALUES ('p1', 's1', 'Tapal', 'tapal', 'c1', 'x1', 'piece', 100, 150, 1, 2);
    `);
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const insert = (
    overrides: Partial<{
      type: string;
      qty: number;
      cost: number;
      reason: string | null;
      sourceType: string | null;
      sourceId: string | null;
    }> = {},
  ) => {
    const row = {
      type: "receipt",
      qty: 1000,
      cost: 100,
      reason: null,
      sourceType: null,
      sourceId: null,
      ...overrides,
    };
    database.sqlite
      .prepare(
        "INSERT INTO stock_movements (id, store_id, terminal_id, product_id, type, qty_milli, unit_cost_paisa, source_type, source_id, reason, actor_user_id, created_at) VALUES (?, 's1', 't1', 'p1', ?, ?, ?, ?, ?, ?, 'u1', 1)",
      )
      .run(
        `m${Math.random()}`,
        row.type,
        row.qty,
        row.cost,
        row.sourceType,
        row.sourceId,
        row.reason,
      );
  };

  const plan = (query: string) =>
    (database.sqlite.prepare(`EXPLAIN QUERY PLAN ${query}`).all("p1") as { detail: string }[])
      .map((row) => row.detail)
      .join(" ");

  it("accepts valid movements", () => {
    insert();
    insert({ type: "sale", qty: -500 });
    insert({ type: "adjustment", qty: -500, reason: "theft" });
    insert({ type: "damage", qty: -500, reason: "damage" });
    insert({ sourceType: "sale_line", sourceId: "l1" });
    expect(database.sqlite.prepare("SELECT count(*) AS n FROM stock_movements").get()).toEqual({
      n: 5,
    });
  });

  it("requires a reason on adjustments and refuses one on other types", () => {
    expect(() => insert({ type: "adjustment", qty: -1, reason: null })).toThrow();
    expect(() => insert({ type: "damage", qty: -1, reason: null })).toThrow();
    expect(() => insert({ type: "adjustment", qty: -1, reason: "lost" })).toThrow();
    expect(() => insert({ type: "sale", qty: -1, reason: "damage" })).toThrow();
  });

  it("refuses zero quantity, negative cost, an unpaired source and an unknown type", () => {
    expect(() => insert({ qty: 0 })).toThrow();
    expect(() => insert({ cost: -1 })).toThrow();
    expect(() => insert({ sourceType: "sale_line", sourceId: null })).toThrow();
    expect(() => insert({ sourceType: null, sourceId: "l1" })).toThrow();
    expect(() => insert({ type: "transfer" })).toThrow();
  });

  it("uses the product indexes for on-hand and history queries", () => {
    expect(plan("SELECT SUM(qty_milli) FROM stock_movements WHERE product_id = ?")).toContain(
      "stock_movements_product_id",
    );
    expect(
      plan(
        "SELECT * FROM stock_movements WHERE product_id = ? ORDER BY created_at DESC, id DESC LIMIT 50",
      ),
    ).toContain("stock_movements_product_id");
  });
});

describe("stock movements migration on an existing database", () => {
  it("adds an empty ledger and keeps existing rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "vendora-upgrade-"));
    const database = openDatabase(join(dir, "vendora.db"));
    try {
      const oldFolder = join(dir, "old-migrations");
      mkdirSync(join(oldFolder, "meta"), { recursive: true });
      const journal = JSON.parse(
        readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
      ) as { entries: { tag: string }[] };
      journal.entries = journal.entries.slice(0, 10);
      writeFileSync(join(oldFolder, "meta", "_journal.json"), JSON.stringify(journal));
      for (const entry of journal.entries) {
        copyFileSync(
          join(migrationsFolder, `${entry.tag}.sql`),
          join(oldFolder, `${entry.tag}.sql`),
        );
      }

      const backupDir = join(dir, "backups");
      runMigrations(database, { migrationsFolder: oldFolder, backupDir });
      database.sqlite.exec(`
        INSERT INTO stores (id, created_at, updated_at) VALUES ('s1', 1, 2);
        INSERT INTO categories (id, store_id, name, created_at, updated_at) VALUES ('c1', 's1', 'Tea', 1, 2);
        INSERT INTO tax_categories (id, store_id, name, rate_bps, created_at, updated_at) VALUES ('x1', 's1', 'Standard', 1800, 1, 2);
        INSERT INTO products (id, store_id, name_en, search_text, category_id, tax_category_id, unit, cost_paisa, sale_price_paisa, created_at, updated_at)
          VALUES ('p1', 's1', 'Tapal', 'tapal', 'c1', 'x1', 'piece', 100, 150, 1, 2);
        INSERT INTO product_barcodes (id, store_id, product_id, barcode, created_at, updated_at) VALUES ('b1', 's1', 'p1', '123', 1, 2);
        INSERT INTO users (id, username, display_name, password_hash, pin_hash, created_at, updated_at) VALUES ('u1', 'owner', 'Owner', 'p', 'q', 1, 2);
      `);
      const snapshot = () => ({
        products: (
          database.sqlite.prepare("SELECT * FROM products").all() as Record<string, unknown>[]
        ).map((row) => {
          const copy = { ...row };
          delete copy.is_third_schedule;
          return copy;
        }),
        barcodes: database.sqlite.prepare("SELECT * FROM product_barcodes").all(),
        users: database.sqlite.prepare("SELECT * FROM users").all(),
      });
      const before = snapshot();

      expect(runMigrations(database, { migrationsFolder, backupDir })).toBe("migrated");

      expect(readdirSync(backupDir).filter((f) => /^pre-migrate-.*\.db$/.test(f))).toHaveLength(1);
      expect(snapshot()).toEqual(before);
      expect(database.sqlite.pragma("foreign_key_check")).toEqual([]);
      expect(database.sqlite.prepare("SELECT count(*) AS n FROM stock_movements").get()).toEqual({
        n: 0,
      });
      const indexes = database.sqlite
        .prepare(
          "SELECT name FROM pragma_index_list('stock_movements') WHERE origin = 'c' ORDER BY name",
        )
        .all();
      expect(indexes).toEqual([
        { name: "stock_movements_product_id_created_at_idx" },
        { name: "stock_movements_product_id_idx" },
      ]);
    } finally {
      database.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("receipt and printer columns migration", () => {
  it("adds nullable header fields, printer defaults and the date index, keeping sales", () => {
    const dir = mkdtempSync(join(tmpdir(), "vendora-printer-"));
    const database = openDatabase(join(dir, "vendora.db"));
    try {
      const sql = readFileSync(
        join(migrationsFolder, "0013_overjoyed_serpent_society.sql"),
        "utf8",
      );
      expect(sql).not.toContain("__new_");

      const oldFolder = join(dir, "old-migrations");
      mkdirSync(join(oldFolder, "meta"), { recursive: true });
      const journal = JSON.parse(
        readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
      ) as { entries: { tag: string }[] };
      journal.entries = journal.entries.slice(0, 13);
      writeFileSync(join(oldFolder, "meta", "_journal.json"), JSON.stringify(journal));
      for (const entry of journal.entries) {
        copyFileSync(
          join(migrationsFolder, `${entry.tag}.sql`),
          join(oldFolder, `${entry.tag}.sql`),
        );
      }

      const backupDir = join(dir, "backups");
      runMigrations(database, { migrationsFolder: oldFolder, backupDir });
      database.sqlite.exec(`
        INSERT INTO stores (id, name, created_at, updated_at) VALUES ('s1', 'Existing', 1, 2);
        INSERT INTO terminals (id, store_id, code, created_at, updated_at) VALUES ('t1', 's1', 'T1', 1, 2);
        INSERT INTO users (id, username, display_name, password_hash, pin_hash, created_at, updated_at) VALUES ('u1', 'owner', 'Owner', 'p', 'q', 1, 2);
        INSERT INTO shifts (id, store_id, terminal_id, opened_by, opened_at, opening_float_paisa, created_at, updated_at)
          VALUES ('sh1', 's1', 't1', 'u1', 1, 0, 1, 2);
      `);
      const before = database.sqlite.prepare("SELECT id, code FROM terminals").all();

      expect(runMigrations(database, { migrationsFolder, backupDir })).toBe("migrated");

      expect(readdirSync(backupDir).filter((f) => /^pre-migrate-.*\.db$/.test(f))).toHaveLength(1);
      expect(database.sqlite.prepare("SELECT id, code FROM terminals").all()).toEqual(before);
      expect(
        database.sqlite
          .prepare(
            "SELECT name, address, phone, ntn, strn, receipt_header_en, receipt_footer_ur FROM stores",
          )
          .get(),
      ).toEqual({
        name: "Existing",
        address: null,
        phone: null,
        ntn: null,
        strn: null,
        receipt_header_en: null,
        receipt_footer_ur: null,
      });
      expect(
        database.sqlite
          .prepare(
            "SELECT printer_kind, printer_name, printer_host, printer_port, paper_width_mm, print_mode FROM terminals",
          )
          .get(),
      ).toEqual({
        printer_kind: "none",
        printer_name: null,
        printer_host: null,
        printer_port: null,
        paper_width_mm: 80,
        print_mode: "print",
      });
      const indexes = database.sqlite
        .prepare("SELECT name FROM pragma_index_list('sales') WHERE origin = 'c'")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(indexes).toContain("sales_terminal_id_created_at_idx");
      expect(database.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      database.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("stocktake schema", () => {
  let dir: string;
  let database: VendoraDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-stocktake-schema-"));
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, { migrationsFolder, backupDir: join(dir, "backups") });
    database.sqlite.exec(`
      INSERT INTO stores (id, created_at, updated_at) VALUES ('s1', 1, 2);
      INSERT INTO terminals (id, store_id, code, created_at, updated_at) VALUES ('t1', 's1', 'T1', 1, 2);
      INSERT INTO users (id, username, display_name, password_hash, pin_hash, created_at, updated_at) VALUES ('u1', 'owner', 'Owner', 'p', 'q', 1, 2);
      INSERT INTO categories (id, store_id, name, created_at, updated_at) VALUES ('c1', 's1', 'Tea', 1, 2);
      INSERT INTO tax_categories (id, store_id, name, rate_bps, created_at, updated_at) VALUES ('x1', 's1', 'Standard', 1800, 1, 2);
      INSERT INTO products (id, store_id, name_en, search_text, category_id, tax_category_id, unit, cost_paisa, sale_price_paisa, created_at, updated_at)
        VALUES ('p1', 's1', 'Tapal', 'tapal', 'c1', 'x1', 'piece', 100, 150, 1, 2);
    `);
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const insertStocktake = (id: string, scope: string, categoryId: string | null, status = "open") =>
    database.sqlite
      .prepare(
        "INSERT INTO stocktakes (id, store_id, terminal_id, scope, category_id, status, started_by, created_at, updated_at) VALUES (?, 's1', 't1', ?, ?, ?, 'u1', 1, 2)",
      )
      .run(id, scope, categoryId, status);

  const insertLine = (
    id: string,
    counted: number | null,
    expected: number | null,
    countedAt: number | null,
  ) =>
    database.sqlite
      .prepare(
        "INSERT INTO stocktake_lines (id, store_id, terminal_id, stocktake_id, product_id, expected_qty_milli, counted_qty_milli, counted_at, created_at, updated_at) VALUES (?, 's1', 't1', 'st1', 'p1', ?, ?, ?, 1, 2)",
      )
      .run(id, expected, counted, countedAt);

  it("ties the category to a category count", () => {
    expect(() => insertStocktake("a", "full", "c1")).toThrow(/stocktakes_scope_category_check/);
    expect(() => insertStocktake("b", "category", null)).toThrow(/stocktakes_scope_category_check/);
    expect(() => insertStocktake("c", "category", "c1", "cancelled")).not.toThrow();
  });

  it("allows one open count per store", () => {
    insertStocktake("a", "full", null);
    expect(() => insertStocktake("b", "full", null)).toThrow(/UNIQUE/);
    expect(() => insertStocktake("c", "full", null, "cancelled")).not.toThrow();
    expect(() => insertStocktake("d", "full", null, "bogus")).toThrow(/stocktakes_status_check/);
  });

  it("keeps counted quantity, expected quantity and time together", () => {
    insertStocktake("st1", "full", null);
    expect(() => insertLine("l1", null, null, null)).not.toThrow();
    database.sqlite.prepare("DELETE FROM stocktake_lines").run();
    expect(() => insertLine("l2", 0, -500, 5)).not.toThrow();
    database.sqlite.prepare("DELETE FROM stocktake_lines").run();
    expect(() => insertLine("l3", 1000, null, 5)).toThrow(/stocktake_lines_counted_set_check/);
    expect(() => insertLine("l4", 1000, 0, null)).toThrow(/stocktake_lines_counted_set_check/);
    expect(() => insertLine("l5", -1, 0, 5)).toThrow(/stocktake_lines_counted_qty_milli_check/);
    expect(() => insertLine("l6", 1.5, 0, 5)).toThrow(/stocktake_lines_integers_check/);
  });

  it("allows one line per product in a count", () => {
    insertStocktake("st1", "full", null);
    insertLine("l1", null, null, null);
    expect(() => insertLine("l2", null, null, null)).toThrow(/UNIQUE/);
  });
});

describe("stocktake migration on an existing database", () => {
  it("adds empty tables and keeps existing rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "vendora-stocktake-upgrade-"));
    const database = openDatabase(join(dir, "vendora.db"));
    try {
      const oldFolder = join(dir, "old-migrations");
      mkdirSync(join(oldFolder, "meta"), { recursive: true });
      const journal = JSON.parse(
        readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
      ) as { entries: { tag: string }[] };
      journal.entries = journal.entries.slice(0, 15);
      writeFileSync(join(oldFolder, "meta", "_journal.json"), JSON.stringify(journal));
      for (const entry of journal.entries) {
        copyFileSync(
          join(migrationsFolder, `${entry.tag}.sql`),
          join(oldFolder, `${entry.tag}.sql`),
        );
      }

      const backupDir = join(dir, "backups");
      runMigrations(database, { migrationsFolder: oldFolder, backupDir });
      database.sqlite.exec(`
        INSERT INTO stores (id, created_at, updated_at) VALUES ('s1', 1, 2);
        INSERT INTO categories (id, store_id, name, created_at, updated_at) VALUES ('c1', 's1', 'Tea', 1, 2);
        INSERT INTO tax_categories (id, store_id, name, rate_bps, created_at, updated_at) VALUES ('x1', 's1', 'Standard', 1800, 1, 2);
        INSERT INTO products (id, store_id, name_en, search_text, category_id, tax_category_id, unit, cost_paisa, sale_price_paisa, created_at, updated_at)
          VALUES ('p1', 's1', 'Tapal', 'tapal', 'c1', 'x1', 'piece', 100, 150, 1, 2);
      `);
      const before = database.sqlite.prepare("SELECT * FROM products").all();

      expect(runMigrations(database, { migrationsFolder, backupDir })).toBe("migrated");

      expect(readdirSync(backupDir).filter((f) => /^pre-migrate-.*\.db$/.test(f))).toHaveLength(1);
      expect(database.sqlite.prepare("SELECT * FROM products").all()).toEqual(before);
      expect(database.sqlite.prepare("SELECT count(*) AS n FROM stocktakes").get()).toEqual({
        n: 0,
      });
      expect(database.sqlite.prepare("SELECT count(*) AS n FROM stocktake_lines").get()).toEqual({
        n: 0,
      });
      expect(database.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      database.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
