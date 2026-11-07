import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VendoraDatabase } from "./client";
import { takeInvoiceNumber } from "./invoice-numbers";
import { formatPurchaseReturnNo, takePurchaseReturnNumber } from "./purchase-return-numbers";
import { openMigratedDatabase } from "./test-database";

describe("formatPurchaseReturnNo", () => {
  it("prefixes PRN and pads to six digits", () => {
    expect(formatPurchaseReturnNo("T1", 1)).toBe("PRN-T1-000001");
    expect(formatPurchaseReturnNo("T1", 1000000)).toBe("PRN-T1-1000000");
  });
});

describe("takePurchaseReturnNumber", () => {
  let dir: string;
  let database: VendoraDatabase;
  const t1 = { id: "t1", storeId: "s1", code: "T1" };
  const t2 = { id: "t2", storeId: "s1", code: "T2" };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-purchase-return-numbers-"));
    database = openMigratedDatabase(join(dir, "vendora.db"));
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
    const taken = [1, 2, 3].map(() =>
      database.db.transaction((tx) => takePurchaseReturnNumber(tx, t1)),
    );
    expect(taken).toEqual(["PRN-T1-000001", "PRN-T1-000002", "PRN-T1-000003"]);
  });

  it("leaves no gap when the transaction rolls back", () => {
    database.db.transaction((tx) => takePurchaseReturnNumber(tx, t1));

    expect(() =>
      database.db.transaction((tx) => {
        expect(takePurchaseReturnNumber(tx, t1)).toBe("PRN-T1-000002");
        throw new Error("return failed");
      }),
    ).toThrow("return failed");

    expect(database.db.transaction((tx) => takePurchaseReturnNumber(tx, t1))).toBe("PRN-T1-000002");
  });

  it("starts every terminal at 000001", () => {
    database.db.transaction((tx) => takePurchaseReturnNumber(tx, t1));
    expect(database.db.transaction((tx) => takePurchaseReturnNumber(tx, t2))).toBe("PRN-T2-000001");
    expect(database.db.transaction((tx) => takePurchaseReturnNumber(tx, t1))).toBe("PRN-T1-000002");
  });

  it("does not advance the invoice or PO sequence", () => {
    database.db.transaction((tx) => takePurchaseReturnNumber(tx, t1));
    expect(database.db.transaction((tx) => takeInvoiceNumber(tx, t1))).toBe("T1-000001");
  });
});
