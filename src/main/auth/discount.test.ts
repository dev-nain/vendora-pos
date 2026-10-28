import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type VendoraDatabase } from "../db/client";
import { runMigrations } from "../db/migrate";
import { stores, type UserRole } from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { checkDiscount } from "./discount";
import type { Session } from "./session";

describe("checkDiscount", () => {
  let dir: string;
  let database: VendoraDatabase;
  let storeId: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-discount-"));
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, {
      migrationsFolder: join(process.cwd(), "drizzle"),
      backupDir: join(dir, "backups"),
    });
    seedStoreAndTerminal(database);
    storeId = database.db.select().from(stores).get()?.id ?? "";
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const session = (role: UserRole): Session => ({
    userId: "u1",
    role,
    storeId,
    loggedInAt: new Date(0),
  });

  it.each([
    [0, "allowed"],
    [499, "allowed"],
    [500, "allowed"],
    [501, "needs-approval"],
  ])("cashier at %i bps -> %s", (bps, expected) => {
    expect(checkDiscount(database, session("cashier"), bps)).toBe(expected);
  });

  it("reads the limit from the store", () => {
    database.db.update(stores).set({ cashierDiscountLimitBps: 1000 }).run();

    expect(checkDiscount(database, session("cashier"), 800)).toBe("allowed");
  });

  it.each(["manager", "owner"] as const)("%s is always allowed", (role) => {
    expect(checkDiscount(database, session(role), 10000)).toBe("allowed");
  });

  it.each([-1, 10001, 1.5, Number.NaN])("rejects %s", (bps) => {
    expect(() => checkDiscount(database, session("cashier"), bps)).toThrow();
  });
});
