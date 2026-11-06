import {
  copyFileSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
  writeSync,
  closeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/client";
import { openMigratedDatabase } from "../db/test-database";
import { seedStoreAndTerminal } from "../db/seed";
import { vacuumInto } from "../db/vacuum-into";
import { checkBackup } from "./restore-check";

const migrationsFolder = join(process.cwd(), "drizzle");

describe("checkBackup", () => {
  let dir: string;
  let good: string;

  const copyOfGood = (name: string) => {
    const file = join(dir, name);
    copyFileSync(good, file);
    return file;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-restore-check-"));
    const database = openMigratedDatabase(join(dir, "source.db"));
    seedStoreAndTerminal(database);
    database.sqlite.exec(`
      WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 400)
      INSERT INTO audit_log (id, store_id, terminal_id, action, details, created_at)
        SELECT 'a' || i, (SELECT id FROM stores), (SELECT id FROM terminals), 'login', hex(zeroblob(100)), 1 FROM n;
    `);
    good = join(dir, "good.db");
    vacuumInto(database.sqlite, good);
    database.sqlite.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a good backup", async () => {
    expect(await checkBackup(good, migrationsFolder)).toEqual({ ok: true });
  });

  it("rejects a text file and an empty file as not a Vendora database", async () => {
    const text = join(dir, "note.db");
    writeFileSync(text, "just some notes that are not sqlite at all");
    const empty = join(dir, "empty.db");
    writeFileSync(empty, "");

    expect(await checkBackup(text, migrationsFolder)).toEqual({ ok: false, reason: "not-vendora" });
    expect(await checkBackup(empty, migrationsFolder)).toEqual({
      ok: false,
      reason: "not-vendora",
    });
  });

  it("rejects a SQLite file with other tables", async () => {
    const other = join(dir, "other.db");
    const sqlite = new Database(other);
    sqlite.exec(
      "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT); INSERT INTO notes (body) VALUES ('x');",
    );
    sqlite.close();

    expect(await checkBackup(other, migrationsFolder)).toEqual({
      ok: false,
      reason: "not-vendora",
    });
  });

  it("rejects a Vendora-shaped file with no terminal", async () => {
    const file = copyOfGood("no-terminal.db");
    const database = openDatabase(file);
    database.sqlite.pragma("foreign_keys = OFF");
    database.sqlite.exec("DELETE FROM terminals");
    database.sqlite.close();

    expect(await checkBackup(file, migrationsFolder)).toEqual({ ok: false, reason: "not-vendora" });
  });

  it("rejects a file with bytes overwritten in the middle as corrupt", async () => {
    const file = copyOfGood("scribbled.db");
    const size = readFileSync(file).length;
    const fd = openSync(file, "r+");
    writeSync(
      fd,
      Buffer.alloc(8192, 0xff),
      0,
      8192,
      Math.floor(size / 2) - (Math.floor(size / 2) % 4096),
    );
    closeSync(fd);

    expect(await checkBackup(file, migrationsFolder)).toEqual({ ok: false, reason: "corrupt" });
  });

  it("rejects a truncated file as corrupt", async () => {
    const file = copyOfGood("cut.db");
    truncateSync(file, 20_000);

    expect(await checkBackup(file, migrationsFolder)).toEqual({ ok: false, reason: "corrupt" });
  });

  it("rejects a backup applied by a later migration as a newer version", async () => {
    const file = copyOfGood("newer.db");
    const database = openDatabase(file);
    database.sqlite.exec(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('future', 9999999999999)",
    );
    database.sqlite.close();

    expect(await checkBackup(file, migrationsFolder)).toEqual({
      ok: false,
      reason: "newer-version",
    });
  });
});
