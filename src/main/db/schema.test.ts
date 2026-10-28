import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type VendoraDatabase } from "./client";
import { runMigrations } from "./migrate";
import { users, type UserRole } from "./schema";

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
