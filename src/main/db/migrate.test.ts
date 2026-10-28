import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type VendoraDatabase } from "./client";
import { runMigrations } from "./migrate";

function writeFixtureMigration(folder: string, tag: string, when: number, sql: string): void {
  mkdirSync(join(folder, "meta"), { recursive: true });
  writeFileSync(join(folder, `${tag}.sql`), sql);
  writeFileSync(
    join(folder, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: [{ idx: 0, version: "6", when, tag, breakpoints: true }],
    }),
  );
}

describe("runMigrations", () => {
  let dir: string;
  let database: VendoraDatabase;
  let migrationsFolder: string;
  let backupDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-migrate-"));
    migrationsFolder = join(dir, "drizzle");
    backupDir = join(dir, "backups");
    mkdirSync(migrationsFolder);
    database = openDatabase(join(dir, "vendora.db"));
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const options = () => ({ migrationsFolder, backupDir });
  const tableExists = (name: string) =>
    database.sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined;

  it("does nothing when there is no journal", () => {
    expect(runMigrations(database, options())).toBe("no-journal");
    expect(existsSync(backupDir)).toBe(false);
  });

  it("applies a fixture migration to a fresh database without a backup", () => {
    writeFixtureMigration(
      migrationsFolder,
      "0000_init",
      1_700_000_000_000,
      "CREATE TABLE a (id TEXT);",
    );

    expect(runMigrations(database, options())).toBe("migrated");
    expect(tableExists("a")).toBe(true);
    expect(existsSync(backupDir)).toBe(false);
  });

  it("skips when every migration is already applied", () => {
    writeFixtureMigration(
      migrationsFolder,
      "0000_init",
      1_700_000_000_000,
      "CREATE TABLE a (id TEXT);",
    );
    runMigrations(database, options());

    expect(runMigrations(database, options())).toBe("up-to-date");
    expect(existsSync(backupDir)).toBe(false);
  });

  it("backs up an existing database before migrating", () => {
    database.sqlite.exec("CREATE TABLE existing (id TEXT); INSERT INTO existing VALUES ('x');");
    writeFixtureMigration(
      migrationsFolder,
      "0000_init",
      1_700_000_000_000,
      "CREATE TABLE a (id TEXT);",
    );

    expect(runMigrations(database, options())).toBe("migrated");

    const backups = readdirSync(backupDir);
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^pre-migrate-.*\.db$/);
    const backup = openDatabase(join(backupDir, backups[0] ?? ""));
    expect(backup.sqlite.prepare("SELECT id FROM existing").get()).toEqual({ id: "x" });
    expect(
      backup.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = 'a'").get(),
    ).toBeUndefined();
    backup.sqlite.close();
  });
});
