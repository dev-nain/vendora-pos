import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Bill, BillResult, CompleteSaleResult } from "../../shared/checkout";
import { UnauthenticatedError } from "../auth/errors";
import { sales, stores } from "../db/schema";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { createReportsService } from "./reports";
import { createSalesService } from "./sales";

const okBill = (result: BillResult): Bill => {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.bill;
};

const okSale = (result: CompleteSaleResult) => {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.sale;
};

const range = (from: string, to = from) => ({ from, to });

describe("sales by day", () => {
  let kit: CheckoutKit;
  let clock: Date;
  let service: ReturnType<typeof createReportsService>;
  let sellingService: ReturnType<typeof createSalesService>;

  beforeEach(() => {
    kit = createCheckoutKit();
    kit.signIn("cashier");
    kit.openShift();
    clock = new Date("2026-11-07T10:00:00.000Z");
    sellingService = createSalesService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      stock: kit.stock,
      now: () => clock,
    });
    service = createReportsService({ database: kit.database, sessions: kit.sessions });
  });

  afterEach(() => kit.close());

  const db = () => kit.database.db;
  const exempt = () => kit.taxCategoryId("Exempt");
  const standard = () => kit.taxCategoryId("Standard");

  const product = (name: string, salePricePaisa: number, overrides = {}) =>
    kit.addProduct({
      nameEn: name,
      searchText: name.toLowerCase(),
      salePricePaisa,
      taxCategoryId: exempt(),
      ...overrides,
    });

  function sellAt(at: string, productId: string, qtyMilli = 1000, paid = 1000000) {
    clock = new Date(at);
    const bill = okBill(kit.billDrafts.addProduct({ productId, qtyMilli }));
    return okSale(
      sellingService.complete({
        draftId: bill.id,
        payments: [{ method: "cash", amountPaisa: paid }],
      }),
    );
  }

  it("puts sales on either side of a Karachi midnight on the right days", () => {
    const tea = product("Tea", 10000);
    sellAt("2026-11-06T18:59:59.000Z", tea.id);
    sellAt("2026-11-06T19:00:00.000Z", tea.id);
    sellAt("2026-11-07T18:59:59.999Z", tea.id);

    const result = service.salesByDay(range("2026-11-06", "2026-11-07"));

    expect(result.rows.map((row) => [row.day, row.billCount])).toEqual([
      ["2026-11-06", 1],
      ["2026-11-07", 2],
    ]);
    expect(service.salesByDay(range("2026-11-08")).rows).toEqual([]);
  });

  it("counts a return on its own day as negative amounts", () => {
    const tea = product("Tea", 10000);
    const sale = sellAt("2026-11-06T10:00:00.000Z", tea.id);
    const line = kit.database.sqlite
      .prepare("SELECT id FROM sale_lines WHERE sale_id = ?")
      .get(sale.id) as {
      id: string;
    };

    clock = new Date("2026-11-07T10:00:00.000Z");
    const bill = okBill(
      kit.returns.addFromSale({
        saleId: sale.id,
        lines: [{ saleLineId: line.id, qtyMilli: 1000 }],
      }),
    );
    okSale(
      sellingService.complete({
        draftId: bill.id,
        payments: [{ method: "cash", amountPaisa: 10000 }],
      }),
    );

    const result = service.salesByDay(range("2026-11-06", "2026-11-07"));

    expect(result.rows).toMatchObject([
      { day: "2026-11-06", billCount: 1, totalPaisa: 10000, pieceQtyMilli: 1000 },
      { day: "2026-11-07", billCount: 1, totalPaisa: -10000, pieceQtyMilli: -1000 },
    ]);
    expect(result.totals).toMatchObject({ billCount: 2, totalPaisa: 0, pieceQtyMilli: 0 });
  });

  it.each([true, false])(
    "keeps net + tax + rounding = total and matches sales with prices including tax %s",
    (includeTax) => {
      db()
        .update(stores)
        .set({ pricesIncludeTax: includeTax, cashRoundingEnabled: true, cashRoundingPaisa: 100 })
        .run();
      const soap = product("Soap", 15050, { taxCategoryId: standard() });
      const rice = product("Rice", 33333, { taxCategoryId: standard(), unit: "kg" });
      sellAt("2026-11-07T08:00:00.000Z", soap.id, 1000, 20000);
      sellAt("2026-11-07T09:00:00.000Z", rice.id, 1500, 100000);
      sellAt("2026-11-07T09:30:00.000Z", soap.id, 3000, 100000);

      const result = service.salesByDay(range("2026-11-07"));
      const [row] = result.rows;
      const direct = kit.database.sqlite
        .prepare(
          "SELECT count(*) AS bills, sum(total_paisa) AS total, sum(tax_paisa) AS tax, sum(rounding_paisa) AS rounding, sum(discount_paisa) AS discount FROM sales",
        )
        .get() as Record<string, number>;

      expect(result.rows).toHaveLength(1);
      expect(row).toMatchObject({
        billCount: direct.bills,
        totalPaisa: direct.total,
        taxPaisa: direct.tax,
        roundingPaisa: direct.rounding,
        discountPaisa: direct.discount,
      });
      expect(row!.netPaisa + row!.taxPaisa + row!.roundingPaisa).toBe(row!.totalPaisa);
      expect(result.totals).toEqual({
        billCount: row!.billCount,
        pieceQtyMilli: row!.pieceQtyMilli,
        kgQtyMilli: row!.kgQtyMilli,
        litreQtyMilli: row!.litreQtyMilli,
        discountPaisa: row!.discountPaisa,
        netPaisa: row!.netPaisa,
        taxPaisa: row!.taxPaisa,
        roundingPaisa: row!.roundingPaisa,
        totalPaisa: row!.totalPaisa,
      });
      for (const value of Object.values(result.totals)) expect(Number.isInteger(value)).toBe(true);
    },
  );

  it("splits quantity by unit and counts misc lines", () => {
    kit.setMiscEnabled(true);
    const soap = product("Soap", 5000);
    const rice = product("Rice", 20000, { unit: "kg" });
    const oil = product("Oil", 30000, { unit: "litre" });
    sellAt("2026-11-07T08:00:00.000Z", soap.id, 2000);
    sellAt("2026-11-07T08:10:00.000Z", rice.id, 1500);
    sellAt("2026-11-07T08:20:00.000Z", oil.id, 2250);
    clock = new Date("2026-11-07T08:30:00.000Z");
    const misc = okBill(kit.billDrafts.addMisc({ name: "Loose", pricePaisa: 7000 }));
    okSale(
      sellingService.complete({
        draftId: misc.id,
        payments: [{ method: "cash", amountPaisa: 7000 }],
      }),
    );

    const [row] = service.salesByDay(range("2026-11-07")).rows;

    expect(row).toMatchObject({
      billCount: 4,
      pieceQtyMilli: 3000,
      kgQtyMilli: 1500,
      litreQtyMilli: 2250,
    });
  });

  it("gives zero totals for an empty range and leaves empty days out", () => {
    const tea = product("Tea", 10000);
    sellAt("2026-11-01T10:00:00.000Z", tea.id);
    sellAt("2026-11-05T10:00:00.000Z", tea.id);

    expect(service.salesByDay(range("2026-11-02", "2026-11-04"))).toEqual({
      rows: [],
      totals: {
        billCount: 0,
        pieceQtyMilli: 0,
        kgQtyMilli: 0,
        litreQtyMilli: 0,
        discountPaisa: 0,
        netPaisa: 0,
        taxPaisa: 0,
        roundingPaisa: 0,
        totalPaisa: 0,
      },
    });
    expect(
      service.salesByDay(range("2026-11-01", "2026-11-05")).rows.map((row) => row.day),
    ).toEqual(["2026-11-01", "2026-11-05"]);
  });

  it("excludes another store's sales", () => {
    const tea = product("Tea", 10000);
    sellAt("2026-11-07T10:00:00.000Z", tea.id);
    const other = db().insert(stores).values({}).returning().get();
    kit.database.sqlite.pragma("foreign_keys = OFF");
    kit.database.sqlite.prepare("UPDATE sales SET store_id = ? WHERE 1 = 1").run(other.id);
    kit.database.sqlite.pragma("foreign_keys = ON");
    expect(
      db()
        .select({ n: sql<number>`count(*)` })
        .from(sales)
        .get()?.n,
    ).toBe(1);

    expect(service.salesByDay(range("2026-11-07")).rows).toEqual([]);
  });

  it("requires a session", () => {
    kit.sessions.end();
    expect(() => service.salesByDay(range("2026-11-07"))).toThrow(UnauthenticatedError);
  });
});
