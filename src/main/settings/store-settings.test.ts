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
import { getCashierDiscountLimitBps } from "./store-settings";

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

  it("keeps an existing store and gives it 500 when migrating from 0000", () => {
    const firstOnly = join(dir, "drizzle-0000");
    cpSync(migrationsFolder, firstOnly, { recursive: true });
    const journalPath = join(firstOnly, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, 1);
    writeFileSync(journalPath, JSON.stringify(journal));

    runMigrations(database, { migrationsFolder: firstOnly, backupDir });
    database.sqlite
      .prepare("INSERT INTO stores (id, name, created_at, updated_at) VALUES ('s1', 'Old', 1, 2)")
      .run();

    runMigrations(database, { migrationsFolder, backupDir });

    expect(database.db.select().from(stores).all()).toEqual([
      expect.objectContaining({ id: "s1", name: "Old", cashierDiscountLimitBps: 500 }),
    ]);
    expect(readdirSync(backupDir).filter((f) => /^pre-migrate-.*\.db$/.test(f))).toHaveLength(1);
  });
});
