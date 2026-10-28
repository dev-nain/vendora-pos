import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type VendoraDatabase } from "./client";
import { runMigrations } from "./migrate";
import { stores, terminals } from "./schema";
import { seedStoreAndTerminal } from "./seed";

describe("seedStoreAndTerminal", () => {
  let dir: string;
  let database: VendoraDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-seed-"));
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, {
      migrationsFolder: join(process.cwd(), "drizzle"),
      backupDir: join(dir, "backups"),
    });
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates one unnamed store with terminal T1", () => {
    seedStoreAndTerminal(database);

    const storeRows = database.db.select().from(stores).all();
    const terminalRows = database.db.select().from(terminals).all();
    expect(storeRows).toHaveLength(1);
    expect(storeRows[0]?.name).toBeNull();
    expect(terminalRows).toHaveLength(1);
    expect(terminalRows[0]?.code).toBe("T1");
    expect(terminalRows[0]?.storeId).toBe(storeRows[0]?.id);
  });

  it("is idempotent", () => {
    seedStoreAndTerminal(database);
    seedStoreAndTerminal(database);

    expect(database.db.select().from(stores).all()).toHaveLength(1);
    expect(database.db.select().from(terminals).all()).toHaveLength(1);
  });

  it("adds only a terminal when a store already exists", () => {
    const store = database.db.insert(stores).values({ name: "Existing" }).returning().get();

    seedStoreAndTerminal(database);

    expect(database.db.select().from(stores).all()).toHaveLength(1);
    const terminalRows = database.db.select().from(terminals).all();
    expect(terminalRows).toHaveLength(1);
    expect(terminalRows[0]?.storeId).toBe(store.id);
  });
});
