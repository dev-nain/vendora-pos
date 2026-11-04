import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type VendoraDatabase } from "../db/client";
import { runMigrations } from "../db/migrate";
import { stores } from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { getCashierDiscountLimitBps, getMiscItemEnabled, getScalePrefixes } from "./store-settings";

const migrationsFolder = join(process.cwd(), "drizzle");

describe("store settings", () => {
  let dir: string;
  let backupDir: string;
  let database: VendoraDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-settings-"));
    backupDir = join(dir, "backups");
    database = openDatabase(join(dir, "vendora.db"));
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const storeId = () => database.db.select().from(stores).get()?.id ?? "";

  it("defaults the cashier discount limit to 500 bps on a seeded store", () => {
    runMigrations(database, { migrationsFolder, backupDir });
    seedStoreAndTerminal(database);

    expect(getCashierDiscountLimitBps(database, storeId())).toBe(500);
    expect(existsSync(backupDir)).toBe(false);
  });

  it("reads an updated limit", () => {
    runMigrations(database, { migrationsFolder, backupDir });
    seedStoreAndTerminal(database);
    database.db.update(stores).set({ cashierDiscountLimitBps: 1000 }).run();

    expect(getCashierDiscountLimitBps(database, storeId())).toBe(1000);
  });

  it("throws for an unknown store", () => {
    runMigrations(database, { migrationsFolder, backupDir });

    expect(() => getCashierDiscountLimitBps(database, "missing")).toThrow("Store not found");
  });

  it.each([-1, 10001])("rejects a limit of %i at the database level", (bps) => {
    runMigrations(database, { migrationsFolder, backupDir });
    seedStoreAndTerminal(database);

    expect(() => database.db.update(stores).set({ cashierDiscountLimitBps: bps }).run()).toThrow();
  });

  it("reads the scale prefixes with defaults 21 and 22", () => {
    runMigrations(database, { migrationsFolder, backupDir });
    seedStoreAndTerminal(database);
    expect(getScalePrefixes(database, storeId())).toEqual({
      weightPrefix: "21",
      pricePrefix: "22",
    });
    database.db.update(stores).set({ scaleWeightPrefix: "02", scalePricePrefix: "29" }).run();
    expect(getScalePrefixes(database, storeId())).toEqual({
      weightPrefix: "02",
      pricePrefix: "29",
    });
  });

  it("throws for an unknown store when reading scale prefixes", () => {
    runMigrations(database, { migrationsFolder, backupDir });

    expect(() => getScalePrefixes(database, "missing")).toThrow("Store not found");
  });

  it("keeps an existing store and gives it 500 when migrating from 0000", () => {
    seedAndMigrate(1);
    expect(database.db.select().from(stores).all()).toEqual([
      expect.objectContaining({ id: "s1", name: "Old", cashierDiscountLimitBps: 500 }),
    ]);
    for (const table of ["terminals", "users", "audit_log"]) {
      expect(database.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 1 });
    }
    expect(readdirSync(backupDir).filter((f) => /^pre-migrate-.*\.db$/.test(f))).toHaveLength(1);
  });

  it("keeps existing rows when migrating from 0001", () => {
    seedAndMigrate(2);
    for (const table of ["terminals", "users", "audit_log"]) {
      expect(database.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 1 });
    }
    expect(readdirSync(backupDir).filter((f) => /^pre-migrate-.*\.db$/.test(f))).toHaveLength(1);
  });

  it("defaults misc item to off and reads an updated value", () => {
    runMigrations(database, { migrationsFolder, backupDir });
    seedStoreAndTerminal(database);

    expect(getMiscItemEnabled(database, storeId())).toBe(false);
    database.db.update(stores).set({ miscItemEnabled: true }).run();
    expect(getMiscItemEnabled(database, storeId())).toBe(true);
  });

  it("throws for an unknown store when reading misc item", () => {
    runMigrations(database, { migrationsFolder, backupDir });

    expect(() => getMiscItemEnabled(database, "missing")).toThrow("Store not found");
  });

  it("keeps an existing store with misc item off when migrating from 0004", () => {
    seedAndMigrate(5);
    expect(getMiscItemEnabled(database, "s1")).toBe(false);
    expect(readdirSync(backupDir).filter((f) => /^pre-migrate-.*\.db$/.test(f))).toHaveLength(1);
  });

  function seedAndMigrate(applied: number) {
    const firstOnly = join(dir, `drizzle-${applied}`);
    cpSync(migrationsFolder, firstOnly, { recursive: true });
    const journalPath = join(firstOnly, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, applied);
    writeFileSync(journalPath, JSON.stringify(journal));

    runMigrations(database, { migrationsFolder: firstOnly, backupDir });
    database.sqlite
      .prepare("INSERT INTO stores (id, name, created_at, updated_at) VALUES ('s1', 'Old', 1, 2)")
      .run();
    database.sqlite
      .prepare(
        "INSERT INTO terminals (id, store_id, code, created_at, updated_at) VALUES ('t1', 's1', 'T1', 1, 2)",
      )
      .run();
    database.sqlite
      .prepare(
        "INSERT INTO users (id, username, display_name, role, password_hash, pin_hash, created_at, updated_at) VALUES ('u1', 'owner', 'Owner', 'owner', 'p', 'q', 1, 2)",
      )
      .run();
    database.sqlite
      .prepare(
        "INSERT INTO audit_log (id, store_id, terminal_id, actor_user_id, action, created_at) VALUES ('a1', 's1', 't1', 'u1', 'x', 1)",
      )
      .run();

    runMigrations(database, { migrationsFolder, backupDir });
  }
});
