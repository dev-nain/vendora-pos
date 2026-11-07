import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentModel } from "../../shared/document";
import type { Bill, BillResult, CompleteSaleResult } from "../../shared/checkout";
import type { ReportExportFormat } from "../../shared/reports";
import { UnauthenticatedError } from "../auth/errors";
import { products, stores, taxCategories } from "../db/schema";
import type { DocumentRenderer } from "../documents/document-window";
import { rateText } from "../receipts/receipt-model";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { createReportsService } from "./reports";
import { createSalesService } from "./sales";
import { shiftSalesSummary } from "./shift-sales";

const okBill = (result: BillResult): Bill => {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.bill;
};

const okSale = (result: CompleteSaleResult) => {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.sale;
};

const day = { from: "2026-11-07", to: "2026-11-07" };

describe("sales tax summary", () => {
  let kit: CheckoutKit;
  let clock: Date;
  let service: ReturnType<typeof createReportsService>;
  let selling: ReturnType<typeof createSalesService>;
  let toPdf: ReturnType<typeof vi.fn<(model: DocumentModel) => Promise<Buffer>>>;
  let chooseSavePath: ReturnType<
    typeof vi.fn<(name: string, format: ReportExportFormat) => Promise<string | null>>
  >;

  beforeEach(() => {
    kit = createCheckoutKit();
    kit.signIn("cashier");
    kit.openShift();
    clock = new Date("2026-11-07T10:00:00.000Z");
    selling = createSalesService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      stock: kit.stock,
      now: () => clock,
    });
    toPdf = vi.fn(async () => Buffer.from("%PDF-1.4 fake"));
    chooseSavePath = vi.fn(async (name: string) => join(kit.dir, name));
    const renderer: DocumentRenderer = { toPdf, print: vi.fn(async () => "printed" as const) };
    service = createReportsService({
      database: kit.database,
      sessions: kit.sessions,
      renderer,
      chooseSavePath,
    });
  });

  afterEach(() => kit.close());

  const db = () => kit.database.db;
  const standard = () => kit.taxCategoryId("Standard");
  const exempt = () => kit.taxCategoryId("Exempt");
  const reduced = () =>
    db()
      .insert(taxCategories)
      .values({ storeId: kit.storeId, name: "Reduced", rateBps: 500 })
      .returning()
      .get();

  const product = (name: string, salePricePaisa: number, overrides = {}) =>
    kit.addProduct({
      nameEn: name,
      searchText: name.toLowerCase(),
      salePricePaisa,
      taxCategoryId: standard(),
      ...overrides,
    });

  function sell(ids: string[], at = "2026-11-07T10:00:00.000Z", setup?: (draftId: string) => void) {
    clock = new Date(at);
    let bill!: Bill;
    for (const productId of ids) bill = okBill(kit.billDrafts.addProduct({ productId }));
    setup?.(bill.id);
    return okSale(
      selling.complete({ draftId: bill.id, payments: [{ method: "cash", amountPaisa: 10000000 }] }),
    );
  }

  const lineOf = (saleId: string) =>
    kit.database.sqlite.prepare("SELECT id FROM sale_lines WHERE sale_id = ?").get(saleId) as {
      id: string;
    };

  function returnLine(saleId: string, at: string, qtyMilli = 1000) {
    clock = new Date(at);
    const bill = okBill(
      kit.returns.addFromSale({ saleId, lines: [{ saleLineId: lineOf(saleId).id, qtyMilli }] }),
    );
    return okSale(
      selling.complete({
        draftId: bill.id,
        payments: [{ method: "cash", amountPaisa: Math.abs(bill.totals.totalPaisa) }],
      }),
    );
  }

  const mixed = () => {
    const r = reduced();
    return [
      product("Tea", 11800).id,
      product("Soap", 10500, { taxCategoryId: r.id }).id,
      product("Rice", 5000, { taxCategoryId: exempt() }).id,
    ];
  };

  it("groups a mixed bill by rate, tax-inclusive", () => {
    sell(mixed());

    const result = service.salesTaxSummary(day);

    expect(result.rows).toEqual([
      { rate: "18%", taxablePaisa: 10000, taxPaisa: 1800, totalPaisa: 11800 },
      { rate: "5%", taxablePaisa: 10000, taxPaisa: 500, totalPaisa: 10500 },
      { rate: "0%", taxablePaisa: 5000, taxPaisa: 0, totalPaisa: 5000 },
    ]);
    expect(result.totals).toEqual({ taxablePaisa: 25000, taxPaisa: 2300, totalPaisa: 27300 });
  });

  it("adds tax on top for a tax-exclusive store", () => {
    db().update(stores).set({ pricesIncludeTax: false }).run();
    sell([product("Tea", 10000).id]);

    expect(service.salesTaxSummary(day).rows).toEqual([
      { rate: "18%", taxablePaisa: 10000, taxPaisa: 1800, totalPaisa: 11800 },
    ]);
  });

  it.each([true, false])("keeps taxable + tax = total per row, inclusive %s", (inclusive) => {
    db().update(stores).set({ pricesIncludeTax: inclusive }).run();
    sell(mixed(), undefined, (draftId) =>
      kit.billDrafts.setBillDiscount({ draftId, discount: { kind: "percent", bps: 1000 } }),
    );

    const { rows, totals } = service.salesTaxSummary(day);
    const direct = kit.database.sqlite
      .prepare(
        "SELECT sum(tax_paisa) AS tax, sum(total_paisa - tax_paisa) AS taxable FROM sale_lines",
      )
      .get() as { tax: number; taxable: number };
    const bill = kit.database.sqlite.prepare("SELECT sum(tax_paisa) AS tax FROM sales").get() as {
      tax: number;
    };

    for (const row of rows) expect(row.taxablePaisa + row.taxPaisa).toBe(row.totalPaisa);
    expect(totals.taxPaisa).toBe(direct.tax);
    expect(totals.taxablePaisa).toBe(direct.taxable);
    expect(direct.tax).toBe(bill.tax);
  });

  it("agrees with sales by day under cash rounding", () => {
    db().update(stores).set({ cashRoundingEnabled: true, cashRoundingPaisa: 100 }).run();
    sell([product("Soap", 15050).id, product("Rice", 33333).id]);

    const { totals } = service.salesTaxSummary(day);
    const [byDay] = service.salesByDay(day).rows;

    expect(totals.taxablePaisa).toBe(byDay!.netPaisa);
    expect(totals.taxPaisa).toBe(byDay!.taxPaisa);
    expect(totals.totalPaisa).toBe(byDay!.netPaisa + byDay!.taxPaisa);
  });

  describe("returns", () => {
    it("reduces the charged rate, and a full return nets the row to zero", () => {
      const sale = sell([product("Tea", 11800).id]);

      returnLine(sale.id, "2026-11-07T11:00:00.000Z");

      expect(service.salesTaxSummary(day).rows).toEqual([
        { rate: "18%", taxablePaisa: 0, taxPaisa: 0, totalPaisa: 0 },
      ]);
    });

    it("reduces the row by the snapshot split for a partial return", () => {
      const tea = product("Tea", 11800);
      clock = new Date("2026-11-07T10:00:00.000Z");
      const bill = okBill(kit.billDrafts.addProduct({ productId: tea.id, qtyMilli: 2000 }));
      const sale = okSale(
        selling.complete({ draftId: bill.id, payments: [{ method: "cash", amountPaisa: 30000 }] }),
      );

      returnLine(sale.id, "2026-11-07T11:00:00.000Z");

      expect(service.salesTaxSummary(day).rows).toEqual([
        { rate: "18%", taxablePaisa: 10000, taxPaisa: 1800, totalPaisa: 11800 },
      ]);
    });

    it("shows negative amounts when only the return is in the period", () => {
      const sale = sell([product("Tea", 11800).id], "2026-11-06T10:00:00.000Z");
      returnLine(sale.id, "2026-11-07T10:00:00.000Z");

      expect(service.salesTaxSummary(day).rows).toEqual([
        { rate: "18%", taxablePaisa: -10000, taxPaisa: -1800, totalPaisa: -11800 },
      ]);
    });

    it("reduces the old rate after the rate changed", () => {
      const sale = sell([product("Tea", 11800).id], "2026-11-06T10:00:00.000Z");
      db().update(stores).set({ standardTaxRateBps: 800 }).run();
      returnLine(sale.id, "2026-11-07T10:00:00.000Z");

      expect(service.salesTaxSummary(day).rows.map((row) => row.rate)).toEqual(["18%"]);
    });

    it("lands an unlinked return on the product's current rate", () => {
      const tea = product("Tea", 11800);
      clock = new Date("2026-11-07T10:00:00.000Z");
      const bill = okBill(kit.billDrafts.addProduct({ productId: tea.id, isReturn: true }));
      okSale(
        selling.complete({ draftId: bill.id, payments: [{ method: "cash", amountPaisa: 11800 }] }),
      );

      expect(service.salesTaxSummary(day).rows).toEqual([
        { rate: "18%", taxablePaisa: -10000, taxPaisa: -1800, totalPaisa: -11800 },
      ]);
    });
  });

  it("ignores later changes to the tax category and store rate", () => {
    const r = reduced();
    sell([product("Tea", 11800).id, product("Soap", 10500, { taxCategoryId: r.id }).id]);
    const before = service.salesTaxSummary(day);

    db().update(taxCategories).set({ rateBps: 800 }).where(eq(taxCategories.id, r.id)).run();
    db().update(stores).set({ standardTaxRateBps: 1000 }).run();
    db()
      .update(taxCategories)
      .set({ deletedAt: new Date() })
      .where(eq(taxCategories.id, r.id))
      .run();

    expect(service.salesTaxSummary(day)).toEqual(before);
  });

  it("gives Third Schedule goods their own row from the snapshot", () => {
    const flagged = product("Cigarettes", 11800, { isThirdSchedule: true });
    const plain = product("Tea", 11800);
    const sale = sell([plain.id, flagged.id]);

    const expected = [
      { rate: "18%", taxablePaisa: 10000, taxPaisa: 1800, totalPaisa: 11800 },
      { rate: "18% · Third Schedule", taxablePaisa: 10000, taxPaisa: 1800, totalPaisa: 11800 },
    ];
    expect(service.salesTaxSummary(day).rows).toEqual(expected);

    db().update(products).set({ isThirdSchedule: false }).where(eq(products.id, flagged.id)).run();
    expect(service.salesTaxSummary(day).rows).toEqual(expected);

    const flaggedLine = kit.database.sqlite
      .prepare("SELECT id FROM sale_lines WHERE sale_id = ? AND is_third_schedule = 1")
      .get(sale.id) as { id: string };
    clock = new Date("2026-11-07T12:00:00.000Z");
    const bill = okBill(
      kit.returns.addFromSale({
        saleId: sale.id,
        lines: [{ saleLineId: flaggedLine.id, qtyMilli: 1000 }],
      }),
    );
    okSale(
      selling.complete({ draftId: bill.id, payments: [{ method: "cash", amountPaisa: 11800 }] }),
    );
    expect(service.salesTaxSummary(day).rows[1]).toEqual({
      rate: "18% · Third Schedule",
      taxablePaisa: 0,
      taxPaisa: 0,
      totalPaisa: 0,
    });
  });

  it("agrees with the Z-report taxes", () => {
    db().update(stores).set({ cashRoundingEnabled: true, cashRoundingPaisa: 100 }).run();
    const first = sell(mixed(), undefined, (draftId) =>
      kit.billDrafts.setBillDiscount({ draftId, discount: { kind: "percent", bps: 500 } }),
    );
    db().update(stores).set({ cashRoundingEnabled: false }).run();
    returnLine(first.id, "2026-11-07T11:00:00.000Z");
    const shiftId = (
      kit.database.sqlite.prepare("SELECT shift_id AS id FROM sales LIMIT 1").get() as {
        id: string;
      }
    ).id;

    const zTaxes = shiftSalesSummary(db(), shiftId).taxes.map((row) => [
      rateText(row.rateBps),
      row.taxablePaisa,
      row.taxPaisa,
    ]);
    const rows = service
      .salesTaxSummary(day)
      .rows.map((row) => [row.rate, row.taxablePaisa, row.taxPaisa]);
    expect(rows).toEqual(zTaxes);

    sell([product("Cigarettes", 11800, { isThirdSchedule: true }).id]);
    const z = shiftSalesSummary(db(), shiftId).taxes;
    const { totals } = service.salesTaxSummary(day);
    expect(totals.taxPaisa).toBe(z.reduce((sum, row) => sum + row.taxPaisa, 0));
    expect(totals.taxablePaisa).toBe(z.reduce((sum, row) => sum + row.taxablePaisa, 0));
  });

  it("splits store days at Karachi midnight and gives zeros for an empty range", () => {
    const tea = product("Tea", 11800);
    sell([tea.id], "2026-11-06T18:59:59.000Z");
    sell([tea.id], "2026-11-06T19:00:00.000Z");

    expect(
      service.salesTaxSummary({ from: "2026-11-06", to: "2026-11-06" }).totals.totalPaisa,
    ).toBe(11800);
    expect(service.salesTaxSummary(day).totals.totalPaisa).toBe(11800);
    expect(service.salesTaxSummary({ from: "2026-11-09", to: "2026-11-09" })).toEqual({
      rows: [],
      totals: { taxablePaisa: 0, taxPaisa: 0, totalPaisa: 0 },
    });
  });

  it("requires a session", async () => {
    kit.sessions.end();
    expect(() => service.salesTaxSummary(day)).toThrow(UnauthenticatedError);
    await expect(
      service.exportSalesTaxSummary({ range: day, format: "csv" }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  describe("export", () => {
    it("writes the CSV with labels and a Total row", async () => {
      sell([product("Cigarettes", 11800, { isThirdSchedule: true }).id]);
      const range = { from: "2026-11-01", to: "2026-11-07" };

      const result = await service.exportSalesTaxSummary({ range, format: "csv" });

      const path = join(kit.dir, "sales-tax-summary-2026-11-01-to-2026-11-07.csv");
      expect(result).toEqual({ ok: true, status: "saved", path });
      const text = readFileSync(path, "utf8");
      expect(text).toContain("Tax rate,Taxable value,Tax,Total\r\n");
      expect(text).toContain("18% · Third Schedule,100.00,18.00,118.00\r\n");
      expect(text.endsWith("Total,100.00,18.00,118.00\r\n")).toBe(true);
    });

    it("writes negative amounts with a leading minus", async () => {
      const sale = sell([product("Tea", 11800).id], "2026-11-06T10:00:00.000Z");
      returnLine(sale.id, "2026-11-07T10:00:00.000Z");

      await service.exportSalesTaxSummary({ range: day, format: "csv" });

      const text = readFileSync(join(kit.dir, "sales-tax-summary-2026-11-07.csv"), "utf8");
      expect(text).toContain("18%,-100.00,-18.00,-118.00\r\n");
    });

    it("renders the PDF with four columns", async () => {
      sell([product("Tea", 11800).id]);

      await service.exportSalesTaxSummary({ range: day, format: "pdf" });

      const model = toPdf.mock.calls[0]![0];
      expect(model).toMatchObject({ title: "Sales tax summary", landscape: true });
      expect(model.rows[0]).toHaveLength(4);
    });

    it("returns cancelled and writes nothing", async () => {
      chooseSavePath.mockResolvedValueOnce(null);
      expect(await service.exportSalesTaxSummary({ range: day, format: "csv" })).toEqual({
        ok: true,
        status: "cancelled",
      });
    });
  });
});
