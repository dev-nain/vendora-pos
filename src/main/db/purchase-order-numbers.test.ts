import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VendoraDatabase } from "./client";
import { takeInvoiceNumber } from "./invoice-numbers";
import { formatPurchaseOrderNo, takePurchaseOrderNumber } from "./purchase-order-numbers";
import { openMigratedDatabase } from "./test-database";

describe("formatPurchaseOrderNo", () => {
  it("prefixes PO and pads to six digits", () => {
    expect(formatPurchaseOrderNo("T1", 1)).toBe("PO-T1-000001");
    expect(formatPurchaseOrderNo("T1", 1000000)).toBe("PO-T1-1000000");
  });
});

describe("takePurchaseOrderNumber", () => {
  let dir: string;
  let database: VendoraDatabase;
  const t1 = { id: "t1", storeId: "s1", code: "T1" };
  const t2 = { id: "t2", storeId: "s1", code: "T2" };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-po-numbers-"));
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
      database.db.transaction((tx) => takePurchaseOrderNumber(tx, t1)),
    );
    expect(taken).toEqual(["PO-T1-000001", "PO-T1-000002", "PO-T1-000003"]);
  });

  it("leaves no gap when the transaction rolls back", () => {
    database.db.transaction((tx) => takePurchaseOrderNumber(tx, t1));

    expect(() =>
      database.db.transaction((tx) => {
        expect(takePurchaseOrderNumber(tx, t1)).toBe("PO-T1-000002");
        throw new Error("order failed");
      }),
    ).toThrow("order failed");

    expect(database.db.transaction((tx) => takePurchaseOrderNumber(tx, t1))).toBe("PO-T1-000002");
  });

  it("starts every terminal at 000001", () => {
    database.db.transaction((tx) => takePurchaseOrderNumber(tx, t1));
    expect(database.db.transaction((tx) => takePurchaseOrderNumber(tx, t2))).toBe("PO-T2-000001");
    expect(database.db.transaction((tx) => takePurchaseOrderNumber(tx, t1))).toBe("PO-T1-000002");
  });

  it("does not advance the invoice sequence", () => {
    database.db.transaction((tx) => takePurchaseOrderNumber(tx, t1));
    expect(database.db.transaction((tx) => takeInvoiceNumber(tx, t1))).toBe("T1-000001");
  });
});
