import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedStoreAndTerminal } from "./seed";
import { checkDatabaseFile, classifyOpenError } from "./startup-check";
import { openMigratedDatabase } from "./test-database";

const migrationsFolder = join(process.cwd(), "drizzle");

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

describe("checkDatabaseFile", () => {
  let dir: string;
  let good: string;

  const copyOfGood = (name: string) => {
    const file = join(dir, name);
    copyFileSync(good, file);
    return file;
  };

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    dir = mkdtempSync(join(tmpdir(), "vendora-startup-check-"));
    const database = openMigratedDatabase(join(dir, "source.db"));
    seedStoreAndTerminal(database);
    database.sqlite.exec(`
      WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 600)
      INSERT INTO audit_log (id, store_id, terminal_id, action, details, created_at)
        SELECT 'a' || i, (SELECT id FROM stores), (SELECT id FROM terminals), 'login', hex(zeroblob(200)), 1 FROM n;
    `);
    database.sqlite.close();
    good = join(dir, "source.db");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports a missing file and does not create it", () => {
    const file = join(dir, "absent.db");
    expect(checkDatabaseFile(file, migrationsFolder)).toEqual({ status: "missing" });
    expect(existsSync(file)).toBe(false);
  });

  it("accepts a healthy migrated file", () => {
    expect(checkDatabaseFile(copyOfGood("ok.db"), migrationsFolder)).toEqual({
      status: "healthy",
    });
  });

  it("treats a zero-byte file as damaged", () => {
    const file = join(dir, "empty.db");
    writeFileSync(file, "");
    expect(checkDatabaseFile(file, migrationsFolder)).toEqual({
      status: "damaged",
      cause: "empty",
    });
    expect(statSync(file).size).toBe(0);
  });

  it("treats a garbage header as not a database and leaves the bytes alone", () => {
    const file = copyOfGood("garbage.db");
    const fd = openSync(file, "r+");
    writeSync(fd, Buffer.alloc(100, 0x41), 0, 100, 0);
    closeSync(fd);
    const before = sha(file);
    expect(checkDatabaseFile(file, migrationsFolder)).toEqual({
      status: "damaged",
      cause: "not-a-database",
    });
    expect(sha(file)).toBe(before);
  });

  it("detects page corruption and leaves the bytes alone", () => {
    const file = copyOfGood("corrupt.db");
    const size = statSync(file).size;
    const fd = openSync(file, "r+");
    const start = Math.floor(size / 4);
    writeSync(fd, Buffer.alloc(Math.floor(size / 2), 0xff), 0, Math.floor(size / 2), start);
    closeSync(fd);
    const before = sha(file);
    expect(checkDatabaseFile(file, migrationsFolder)).toEqual({
      status: "damaged",
      cause: "corrupt",
    });
    expect(sha(file)).toBe(before);
    expect(statSync(file).size).toBe(size);
  });

  it("treats a valid SQLite file without Vendora tables as damaged", () => {
    const file = join(dir, "other.db");
    const sqlite = new Database(file);
    sqlite.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)");
    sqlite.close();
    const before = sha(file);
    expect(checkDatabaseFile(file, migrationsFolder)).toEqual({
      status: "damaged",
      cause: "not-vendora",
    });
    expect(sha(file)).toBe(before);
  });

  it("reports a database from a newer version", () => {
    const file = copyOfGood("newer.db");
    const sqlite = new Database(file);
    sqlite.exec("UPDATE __drizzle_migrations SET created_at = created_at + 100000000000");
    sqlite.close();
    const before = sha(file);
    expect(checkDatabaseFile(file, migrationsFolder)).toEqual({ status: "newer-version" });
    expect(sha(file)).toBe(before);
  });

  it("maps open errors to damage or a retryable failure", () => {
    expect(classifyOpenError(new Database.SqliteError("bad", "SQLITE_CORRUPT_VTAB"))).toEqual({
      damaged: "corrupt",
    });
    expect(classifyOpenError(new Database.SqliteError("bad", "SQLITE_NOTADB"))).toEqual({
      damaged: "not-a-database",
    });
    expect(classifyOpenError(new Database.SqliteError("busy", "SQLITE_BUSY"))).toEqual({
      failure: "in-use",
    });
    expect(classifyOpenError(new Database.SqliteError("locked", "SQLITE_LOCKED"))).toEqual({
      failure: "in-use",
    });
    expect(classifyOpenError({ code: "EBUSY" })).toEqual({ failure: "in-use" });
    for (const code of [
      "SQLITE_CANTOPEN",
      "SQLITE_PERM",
      "SQLITE_READONLY_DBMOVED",
      "SQLITE_AUTH",
    ]) {
      expect(classifyOpenError(new Database.SqliteError("no", code))).toEqual({
        failure: "access-denied",
      });
    }
    expect(classifyOpenError({ code: "EACCES" })).toEqual({ failure: "access-denied" });
    expect(classifyOpenError({ code: "EPERM" })).toEqual({ failure: "access-denied" });
    expect(classifyOpenError(new Database.SqliteError("io", "SQLITE_IOERR_READ"))).toEqual({
      failure: "unreadable",
    });
    expect(classifyOpenError({ code: "EIO" })).toEqual({ failure: "unreadable" });
    expect(classifyOpenError(new Error("odd"))).toEqual({ failure: "unreadable" });
  });
});
