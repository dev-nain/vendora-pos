import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stores, terminals } from "../db/schema";
import { createCheckoutKit, type CheckoutKit } from "../services/checkout-test-kit";
import { createSalesService } from "../services/sales";
import { createStockService } from "../services/stock";
import { loadSaleSnapshot } from "./sale-snapshot";

describe("loadSaleSnapshot", () => {
  let kit: CheckoutKit;
  let saleId: string;

  beforeEach(() => {
    kit = createCheckoutKit();
    const sales = createSalesService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      stock: createStockService({ database: kit.database, audit: kit.audit }),
    });
    kit.signIn("cashier");
    kit.openShift();
    const tea = kit.addProduct({ nameEn: "Tea", nameUr: "چائے", salePricePaisa: 11800 });
    const added = kit.billDrafts.addProduct({ productId: tea.id, qtyMilli: 2000 });
    if (!added.ok) throw new Error("add failed");
    const result = sales.complete({
      draftId: added.bill.id,
      payments: [
        { method: "card", amountPaisa: 10000, reference: "4321" },
        { method: "cash", amountPaisa: 15000 },
      ],
      buyer: { name: "Bilal", ntn: "1234567-8" },
    });
    if (!result.ok) throw new Error("sale failed");
    saleId = result.sale.id;
  });

  afterEach(() => kit.close());

  it("reads the sale, its ordered lines and payments, the cashier and the current header", () => {
    kit.database.db.update(stores).set({ name: "Al Noor", receiptFooterEn: "Thanks" }).run();
    kit.database.db.update(terminals).set({ paperWidthMm: 58 }).run();

    const snapshot = loadSaleSnapshot(kit.database.db, saleId);

    expect(snapshot).toMatchObject({
      sale: {
        invoiceNo: "T1-000001",
        totalPaisa: 23600,
        buyerName: "Bilal",
        buyerNtn: "1234567-8",
      },
      cashierName: "cashier name",
      paperWidthMm: 58,
      store: { name: "Al Noor", footerEn: "Thanks", address: null },
    });
    expect(snapshot?.lines).toHaveLength(1);
    expect(snapshot?.lines[0]).toMatchObject({ nameEn: "Tea", nameUr: "چائے", qtyMilli: 2000 });
    expect(
      snapshot?.payments.map((p) => [p.method, p.amountPaisa, p.reference, p.isChange]),
    ).toEqual([
      ["card", 10000, "4321", false],
      ["cash", 15000, null, false],
      ["cash", -1400, null, true],
    ]);
  });

  it("uses the store settings as they are now, not as they were at the sale", () => {
    kit.database.db.update(stores).set({ name: "First" }).run();
    expect(loadSaleSnapshot(kit.database.db, saleId)?.store.name).toBe("First");

    kit.database.db.update(stores).set({ name: "Second" }).where(eq(stores.id, kit.storeId)).run();

    expect(loadSaleSnapshot(kit.database.db, saleId)?.store.name).toBe("Second");
  });

  it("returns null for an unknown sale", () => {
    expect(loadSaleSnapshot(kit.database.db, "0192f3a0-0000-7000-8000-000000000099")).toBeNull();
  });
});
