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
import { categories, stores, taxCategories, users, type UserRole } from "./schema";

const migrationsFolder = join(process.cwd(), "drizzle");

const newUser = (username: string, role: UserRole = "owner") => ({
  username,
  displayName: "Name",
  role,
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

  it("rejects an unknown role at the database level", () => {
    migrate();
    const invalid = newUser("a", "admin" as UserRole);
    expect(() => database.db.insert(users).values(invalid).run()).toThrow();
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
