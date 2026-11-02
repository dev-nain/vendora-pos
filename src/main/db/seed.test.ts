import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type VendoraDatabase } from "./client";
import { runMigrations } from "./migrate";
import { eq } from "drizzle-orm";
import { categories, stores, taxCategories, terminals } from "./schema";
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

  it("seeds General, Standard and Exempt once", () => {
    seedStoreAndTerminal(database);
    seedStoreAndTerminal(database);

    expect(
      database.db
        .select()
        .from(categories)
        .all()
        .map((c) => c.name),
    ).toEqual(["General"]);
    const tax = database.db.select().from(taxCategories).all();
    expect(tax.map((t) => [t.name, t.rateBps]).toSorted()).toEqual([
      ["Exempt", 0],
      ["Standard", null],
    ]);
  });

  it("does not re-create a soft-deleted default", () => {
    seedStoreAndTerminal(database);
    database.db
      .update(categories)
      .set({ deletedAt: new Date() })
      .where(eq(categories.name, "General"))
      .run();

    seedStoreAndTerminal(database);

    expect(database.db.select().from(categories).all()).toHaveLength(1);
  });

  it("does not add a default that exists with different case", () => {
    const store = database.db.insert(stores).values({}).returning().get();
    database.db.insert(categories).values({ storeId: store.id, name: "general" }).run();
    database.db
      .insert(taxCategories)
      .values({ storeId: store.id, name: "EXEMPT", rateBps: 0 })
      .run();

    seedStoreAndTerminal(database);

    expect(database.db.select().from(categories).all()).toHaveLength(1);
    expect(database.db.select().from(taxCategories).all()).toHaveLength(2);
  });
});
