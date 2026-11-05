import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type VendoraDatabase } from "./client";
import { formatInvoiceNo, takeInvoiceNumber } from "./invoice-numbers";
import { runMigrations } from "./migrate";

const migrationsFolder = join(process.cwd(), "drizzle");

describe("formatInvoiceNo", () => {
  it("pads to six digits and does not truncate seven", () => {
    expect(formatInvoiceNo("T1", 1)).toBe("T1-000001");
    expect(formatInvoiceNo("T1", 999999)).toBe("T1-999999");
    expect(formatInvoiceNo("T1", 1000000)).toBe("T1-1000000");
  });
});

describe("takeInvoiceNumber", () => {
  let dir: string;
  let database: VendoraDatabase;
  const t1 = { id: "t1", storeId: "s1", code: "T1" };
  const t2 = { id: "t2", storeId: "s1", code: "T2" };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-invoice-"));
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, { migrationsFolder, backupDir: join(dir, "backups") });
    database.sqlite.exec(`
      INSERT INTO stores (id, created_at, updated_at) VALUES ('s1', 1, 2);
      INSERT INTO terminals (id, store_id, code, created_at, updated_at) VALUES ('t1', 's1', 'T1', 1, 2);
      INSERT INTO terminals (id, store_id, code, created_at, updated_at) VALUES ('t2', 's1', 'T2', 1, 2);
    `);
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("hands out sequential numbers", () => {
    const taken = [1, 2, 3].map(() => database.db.transaction((tx) => takeInvoiceNumber(tx, t1)));
    expect(taken).toEqual(["T1-000001", "T1-000002", "T1-000003"]);
  });

  it("leaves no gap when the transaction rolls back", () => {
    database.db.transaction((tx) => takeInvoiceNumber(tx, t1));
    database.db.transaction((tx) => takeInvoiceNumber(tx, t1));
    database.db.transaction((tx) => takeInvoiceNumber(tx, t1));

    expect(() =>
      database.db.transaction((tx) => {
        expect(takeInvoiceNumber(tx, t1)).toBe("T1-000004");
        throw new Error("sale failed");
      }),
    ).toThrow("sale failed");

    expect(database.db.transaction((tx) => takeInvoiceNumber(tx, t1))).toBe("T1-000004");
  });

  it("starts every terminal at 000001", () => {
    database.db.transaction((tx) => takeInvoiceNumber(tx, t1));
    expect(database.db.transaction((tx) => takeInvoiceNumber(tx, t2))).toBe("T2-000001");
    expect(database.db.transaction((tx) => takeInvoiceNumber(tx, t1))).toBe("T1-000002");
  });
});
