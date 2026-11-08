import { createHash } from "node:crypto";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedStoreAndTerminal } from "./seed";
import { openAppDatabase } from "./startup";
import { openMigratedDatabase } from "./test-database";

const migrationsFolder = join(process.cwd(), "drizzle");

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

const count = (database: { sqlite: Database.Database }, table: string) =>
  (database.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("openAppDatabase", () => {
  let dir: string;
  let databaseFile: string;
  let backupDir: string;

  const open = (folder = migrationsFolder) =>
    openAppDatabase({ databaseFile, migrationsFolder: folder, backupDir });

  const makeHealthy = () => {
    const database = openMigratedDatabase(databaseFile);
    seedStoreAndTerminal(database);
    database.sqlite.exec(`
      WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 600)
      INSERT INTO audit_log (id, store_id, terminal_id, action, details, created_at)
        SELECT 'a' || i, (SELECT id FROM stores), (SELECT id FROM terminals), 'login', hex(zeroblob(200)), 1 FROM n;
    `);
    database.sqlite.close();
  };

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    dir = mkdtempSync(join(tmpdir(), "vendora-startup-"));
    databaseFile = join(dir, "vendora.db");
    backupDir = join(dir, "backups");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("treats a missing file as a first run and seeds the store", async () => {
    const outcome = await open();
    if (outcome.mode !== "normal") throw new Error(`unexpected ${outcome.mode}`);
    expect(outcome.firstRun).toBe(true);
    expect(count(outcome.database, "stores")).toBe(1);
    expect(count(outcome.database, "terminals")).toBe(1);
    outcome.database.sqlite.close();
  });

  it("opens a healthy file without reseeding", async () => {
    makeHealthy();
    const outcome = await open();
    if (outcome.mode !== "normal") throw new Error(`unexpected ${outcome.mode}`);
    expect(outcome.firstRun).toBe(false);
    expect(count(outcome.database, "stores")).toBe(1);
    expect(count(outcome.database, "audit_log")).toBe(600);
    outcome.database.sqlite.close();
  });

  it("reports a corrupt file as damaged and leaves it untouched", async () => {
    makeHealthy();
    const size = statSync(databaseFile).size;
    const fd = openSync(databaseFile, "r+");
    writeSync(fd, Buffer.alloc(Math.floor(size / 2), 0xff), 0, Math.floor(size / 2), 8192);
    closeSync(fd);
    const before = sha(databaseFile);
    expect(await open()).toEqual({ mode: "damaged", cause: "corrupt" });
    expect(sha(databaseFile)).toBe(before);
    expect(existsSync(`${databaseFile}-wal`) ? statSync(`${databaseFile}-wal`).size : 0).toBe(0);
  });

  it("never seeds a zero-byte file", async () => {
    writeFileSync(databaseFile, "");
    expect(await open()).toEqual({ mode: "damaged", cause: "empty" });
    expect(statSync(databaseFile).size).toBe(0);
  });

  it("reports a database from a newer version and leaves it untouched", async () => {
    makeHealthy();
    const sqlite = new Database(databaseFile);
    sqlite.exec("UPDATE __drizzle_migrations SET created_at = created_at + 100000000000");
    sqlite.close();
    const before = sha(databaseFile);
    expect(await open()).toEqual({ mode: "newer-version" });
    expect(sha(databaseFile)).toBe(before);
  });

  it("keeps the file in place when a migration fails", async () => {
    makeHealthy();
    const broken = join(dir, "drizzle");
    cpSync(migrationsFolder, broken, { recursive: true });
    const journalFile = join(broken, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalFile, "utf8")) as {
      entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
    };
    const last = journal.entries.at(-1)!;
    journal.entries.push({
      idx: last.idx + 1,
      version: last.version,
      when: last.when + 1000,
      tag: "9999_broken",
      breakpoints: true,
    });
    writeFileSync(journalFile, JSON.stringify(journal));
    writeFileSync(join(broken, "9999_broken.sql"), "THIS IS NOT SQL;");

    expect(await open(broken)).toEqual({ mode: "migration-failed" });
    expect(existsSync(databaseFile)).toBe(true);
    const sqlite = new Database(databaseFile, { readonly: true });
    expect((sqlite.prepare("SELECT count(*) AS n FROM audit_log").get() as { n: number }).n).toBe(
      600,
    );
    sqlite.close();
  });
});
