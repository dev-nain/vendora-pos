import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VendoraDatabase } from "./client";
import {
  changeRow,
  paymentRow,
  receiptPrintRow,
  resolveTaxRateBps,
  reversalRow,
  saleLineRow,
  saleRow,
} from "./sale-rows";
import { billDrafts, receiptPrints, saleLines, salePayments, sales } from "./schema";
import { openMigratedDatabase } from "./test-database";

const buyer = { name: null, ntn: null, cnic: null, phone: null };
const totals = {
  subtotalPaisa: 150,
  discountPaisa: 0,
  taxPaisa: 23,
  roundingPaisa: 0,
  totalPaisa: 150,
};
const saleInput = {
  storeId: "s1",
  terminalId: "t1",
  shiftId: "sh1",
  draftId: "d1",
  invoiceNo: "T1-000001",
  cashierUserId: "u1",
  refundedSaleId: null,
  pricesIncludeTax: true,
  totals,
  deletedLineCount: 0,
  buyer,
};
const product = {
  id: "p1",
  nameEn: "Tapal",
  nameUr: null,
  unit: "piece" as const,
  costPaisa: 100,
  mrpPaisa: 160,
  pctCode: null,
  isThirdSchedule: false,
  categoryId: null,
  categoryName: null,
};
const lineInput = {
  position: 0,
  product,
  taxRateBps: 1800,
  line: {
    qtyMilli: 1000,
    isReturn: false,
    refundedLineId: null,
    unitPricePaisa: 150,
    packQtyMilli: 1000,
    barcode: null,
    miscName: null,
  },
  amounts: {
    grossPaisa: 150,
    lineDiscountPaisa: 0,
    billDiscountPaisa: 0,
    taxPaisa: 23,
    totalPaisa: 150,
  },
};
const ref = { id: "sale1", storeId: "s1", terminalId: "t1" };

describe("resolveTaxRateBps", () => {
  it("uses the store rate only when the category has none", () => {
    expect(resolveTaxRateBps(null, 1800)).toBe(1800);
    expect(resolveTaxRateBps(0, 1800)).toBe(0);
    expect(resolveTaxRateBps(500, 1800)).toBe(500);
  });
});

const typeFor = (totalPaisa: number) =>
  saleRow({ ...saleInput, totals: { ...totals, totalPaisa } }).type;

describe("saleRow", () => {
  it("is a refund for a negative total and a sale otherwise", () => {
    expect(typeFor(-1)).toBe("refund");
    expect(typeFor(0)).toBe("sale");
    expect(typeFor(150)).toBe("sale");
  });

  it("generates an id unless one is given", () => {
    expect(saleRow(saleInput).id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saleRow({ ...saleInput, id: "fixed" }).id).toBe("fixed");
  });
});

describe("saleLineRow", () => {
  const base = { ...lineInput, sale: { ...ref, refundedSaleId: "orig" } };

  it("uses the misc name and sums the discounts", () => {
    const row = saleLineRow({
      ...base,
      line: { ...base.line, miscName: "Loose rice" },
      amounts: { ...base.amounts, lineDiscountPaisa: 5, billDiscountPaisa: 3 },
    });
    expect(row.nameEn).toBe("Loose rice");
    expect(row.discountPaisa).toBe(8);
    expect(saleLineRow(base).nameEn).toBe("Tapal");
  });

  it("writes the category snapshot and keeps null as null", () => {
    const row = saleLineRow({
      ...base,
      product: { ...base.product, categoryId: "cat1", categoryName: "Tea" },
    });
    expect(row.categoryId).toBe("cat1");
    expect(row.categoryName).toBe("Tea");
    const none = saleLineRow(base);
    expect(none.categoryId).toBeNull();
    expect(none.categoryName).toBeNull();
  });

  it("copies the refunded sale only when there is a refunded line", () => {
    expect(saleLineRow(base).refundedSaleId).toBeNull();
    const linked = saleLineRow({ ...base, line: { ...base.line, refundedLineId: "line1" } });
    expect(linked.refundedSaleId).toBe("orig");
    expect(linked.refundedLineId).toBe("line1");
  });
});

describe("payment builders", () => {
  const cashierUserId = "u1";

  it("nulls the reference on cash and keeps it on other methods", () => {
    const input = { sale: ref, position: 0, amountPaisa: 150, reference: "R1", cashierUserId };
    expect(paymentRow({ ...input, method: "cash" }).reference).toBeNull();
    expect(paymentRow({ ...input, method: "card" }).reference).toBe("R1");
  });

  it("builds change as a negative cash row and rejects non-positive change", () => {
    const row = changeRow({ sale: ref, position: 1, changePaisa: 50, cashierUserId });
    expect(row).toMatchObject({ method: "cash", amountPaisa: -50, isChange: true });
    expect(() => changeRow({ sale: ref, position: 1, changePaisa: 0, cashierUserId })).toThrow();
    expect(() => changeRow({ sale: ref, position: 1, changePaisa: -5, cashierUserId })).toThrow();
  });

  it("reverses with the same sale and method, a negated amount and a link back", () => {
    const original = {
      id: "pay1",
      saleId: "sale1",
      storeId: "s1",
      terminalId: "t1",
      method: "card" as const,
      amountPaisa: 150,
      reference: "R1",
    };
    expect(reversalRow({ original, position: 2, cashierUserId })).toMatchObject({
      saleId: "sale1",
      method: "card",
      amountPaisa: -150,
      reference: "R1",
      reversesPaymentId: "pay1",
      isChange: false,
    });
    expect(
      reversalRow({ original: { ...original, amountPaisa: -150 }, position: 2, cashierUserId })
        .amountPaisa,
    ).toBe(150);
  });
});

describe("rows insert into a migrated database", () => {
  let dir: string;
  let database: VendoraDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-sale-rows-"));
    database = openMigratedDatabase(join(dir, "vendora.db"));
    database.sqlite.exec(`
      INSERT INTO stores (id, created_at, updated_at) VALUES ('s1', 1, 2);
      INSERT INTO terminals (id, store_id, code, created_at, updated_at) VALUES ('t1', 's1', 'T1', 1, 2);
      INSERT INTO users (id, username, display_name, password_hash, pin_hash, created_at, updated_at) VALUES ('u1', 'owner', 'Owner', 'p', 'q', 1, 2);
      INSERT INTO categories (id, store_id, name, created_at, updated_at) VALUES ('c1', 's1', 'Tea', 1, 2);
      INSERT INTO tax_categories (id, store_id, name, rate_bps, created_at, updated_at) VALUES ('x1', 's1', 'Standard', 1800, 1, 2);
      INSERT INTO products (id, store_id, name_en, search_text, category_id, tax_category_id, unit, cost_paisa, sale_price_paisa, created_at, updated_at)
        VALUES ('p1', 's1', 'Tapal', 'tapal', 'c1', 'x1', 'piece', 100, 150, 1, 2);
      INSERT INTO shifts (id, store_id, terminal_id, opened_by, opened_at, opening_float_paisa, created_at, updated_at)
        VALUES ('sh1', 's1', 't1', 'u1', 1, 0, 1, 2);
    `);
    database.db
      .insert(billDrafts)
      .values({ id: "d1", storeId: "s1", terminalId: "t1", shiftId: "sh1", createdBy: "u1" })
      .run();
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a sale, its line, payments, a reversal and a print", () => {
    const sale = saleRow({ ...saleInput, id: "sale1" });
    database.db.insert(sales).values(sale).run();
    database.db
      .insert(saleLines)
      .values(saleLineRow({ ...lineInput, sale: { ...ref, refundedSaleId: null } }))
      .run();
    const cashierUserId = "u1";
    database.db
      .insert(salePayments)
      .values(
        paymentRow({
          sale: ref,
          position: 0,
          method: "card",
          amountPaisa: 200,
          reference: "R1",
          cashierUserId,
        }),
      )
      .run();
    database.db
      .insert(salePayments)
      .values(changeRow({ sale: ref, position: 1, changePaisa: 50, cashierUserId }))
      .run();
    const card = database.db.select().from(salePayments).where(eq(salePayments.position, 0)).get();
    if (!card) throw new Error("card payment missing");
    database.db
      .insert(salePayments)
      .values(
        reversalRow({
          original: {
            id: card.id,
            saleId: card.saleId,
            storeId: card.storeId,
            terminalId: card.terminalId,
            method: card.method,
            amountPaisa: card.amountPaisa,
            reference: card.reference,
          },
          position: 2,
          cashierUserId,
        }),
      )
      .run();
    database.db
      .insert(receiptPrints)
      .values(receiptPrintRow({ sale: ref, printedBy: "u1" }))
      .run();

    expect(database.sqlite.prepare("SELECT count(*) AS n FROM sale_payments").get()).toEqual({
      n: 3,
    });
    expect(database.sqlite.prepare("SELECT count(*) AS n FROM receipt_prints").get()).toEqual({
      n: 1,
    });
  });
});
