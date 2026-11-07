import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bill, BillResult, CompleteSaleResult } from "../../shared/checkout";
import {
  formatReportCell,
  salesByProductColumns,
  type ReportExportFormat,
} from "../../shared/reports";
import { UnauthenticatedError } from "../auth/errors";
import { categories, products, saleLines, stores, users } from "../db/schema";
import type { DocumentModel } from "../../shared/document";
import type { DocumentRenderer } from "../documents/document-window";
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

describe("sales reports", () => {
  let kit: CheckoutKit;
  let clock: Date;
  let service: ReturnType<typeof createReportsService>;
  let sellingService: ReturnType<typeof createSalesService>;
  let toPdf: ReturnType<typeof vi.fn<(model: DocumentModel) => Promise<Buffer>>>;
  let chooseSavePath: ReturnType<
    typeof vi.fn<(name: string, format: ReportExportFormat) => Promise<string | null>>
  >;

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
    toPdf = vi.fn(async () => Buffer.from("%PDF-1.4 fake"));
    chooseSavePath = vi.fn(async (name: string) => join(kit.dir, name));
    const renderer: DocumentRenderer = {
      toPdf,
      print: vi.fn(async () => "printed" as const),
    };
    service = createReportsService({
      database: kit.database,
      sessions: kit.sessions,
      renderer,
      chooseSavePath,
    });
  });

  afterEach(() => kit.close());

  const product = (name: string, salePricePaisa: number, overrides = {}) =>
    kit.addProduct({
      nameEn: name,
      searchText: name.toLowerCase(),
      salePricePaisa,
      taxCategoryId: kit.taxCategoryId("Exempt"),
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

  const db = () => kit.database.db;
  const standard = () => kit.taxCategoryId("Standard");

  function sellBill(
    at: string,
    items: { productId: string; qtyMilli?: number }[],
    options: { billDiscountBps?: number; lineDiscountBps?: number } = {},
  ) {
    clock = new Date(at);
    let bill: Bill | undefined;
    for (const item of items) bill = okBill(kit.billDrafts.addProduct(item));
    if (!bill) throw new Error("nothing to sell");
    if (options.lineDiscountBps) {
      bill = okBill(
        kit.billDrafts.updateLine({
          lineId: bill.lines[0]!.id,
          discount: { kind: "percent", bps: options.lineDiscountBps },
        }),
      );
    }
    if (options.billDiscountBps) {
      bill = okBill(
        kit.billDrafts.setBillDiscount({
          draftId: bill.id,
          discount: { kind: "percent", bps: options.billDiscountBps },
        }),
      );
    }
    return okSale(
      sellingService.complete({
        draftId: bill.id,
        payments: [{ method: "cash", amountPaisa: 10000000 }],
      }),
    );
  }

  const lineOf = (saleId: string, name: string) =>
    db()
      .select()
      .from(saleLines)
      .all()
      .find((row) => row.saleId === saleId && row.nameEn === name)!;

  function refund(at: string, saleId: string, name: string, qtyMilli: number, paisa: number) {
    clock = new Date(at);
    const bill = okBill(
      kit.returns.addFromSale({
        saleId,
        lines: [{ saleLineId: lineOf(saleId, name).id, qtyMilli }],
      }),
    );
    return okSale(
      sellingService.complete({
        draftId: bill.id,
        payments: [{ method: "cash", amountPaisa: paisa }],
      }),
    );
  }

  const newCategory = (name: string) =>
    db().insert(categories).values({ storeId: kit.storeId, name }).returning().get();

  describe("by hour", () => {
    it("puts the instants either side of 09:00 Karachi on adjacent hours", () => {
      const tea = product("Tea", 10000);
      sellAt("2026-11-07T03:59:59.999Z", tea.id);
      sellAt("2026-11-07T04:00:00.000Z", tea.id);

      const { rows } = service.salesByHour(range("2026-11-07"));

      expect(rows.find((row) => row.hour === "08:00")?.billCount).toBe(1);
      expect(rows.find((row) => row.hour === "09:00")?.billCount).toBe(1);
    });

    it("sums the same hour across days and always lists 24 ordered rows", () => {
      const tea = product("Tea", 10000);
      sellAt("2026-11-06T04:10:00.000Z", tea.id);
      sellAt("2026-11-07T04:50:00.000Z", tea.id, 2000);

      const { rows, totals } = service.salesByHour(range("2026-11-06", "2026-11-07"));

      expect(rows.map((row) => row.hour)).toEqual(
        Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`),
      );
      expect(rows[9]).toMatchObject({ billCount: 2, grossPaisa: 30000, totalPaisa: 30000 });
      expect(rows[10]).toMatchObject({ billCount: 0, grossPaisa: 0 });
      expect(totals.billCount).toBe(2);
    });

    it("gives no rows for an empty range", () => {
      expect(service.salesByHour(range("2026-11-07")).rows).toEqual([]);
    });

    it("has the same totals as sales by day for the same range", () => {
      const tea = product("Tea", 10000, { taxCategoryId: kit.taxCategoryId("Standard") });
      sellAt("2026-11-06T04:10:00.000Z", tea.id);
      sellAt("2026-11-07T11:50:00.000Z", tea.id, 2000);
      const both = range("2026-11-06", "2026-11-07");

      const hour = service.salesByHour(both).totals;

      expect(hour).toEqual(service.salesByDay(both).totals);
      for (const value of Object.values(hour)) expect(Number.isInteger(value)).toBe(true);
    });

    it("requires a session", () => {
      kit.sessions.end();
      expect(() => service.salesByHour(range("2026-11-07"))).toThrow(UnauthenticatedError);
    });
  });

  describe("by product, category and cashier", () => {
    const day = range("2026-11-07");

    it("excludes tax from gross in both price modes", () => {
      for (const [includeTax, price] of [
        [true, 11800],
        [false, 10000],
      ] as const) {
        db().update(stores).set({ pricesIncludeTax: includeTax }).run();
        const item = product(`Item ${includeTax}`, price, { taxCategoryId: standard() });
        sellBill("2026-11-07T10:00:00.000Z", [{ productId: item.id }]);
        const row = service
          .salesByProduct(day)
          .rows.find((r) => r.product === `Item ${includeTax}`);
        expect(row).toMatchObject({ grossPaisa: 10000, returnsPaisa: 0, netPaisa: 10000 });
      }
    });

    it("reduces gross by line and bill discounts", () => {
      const tea = product("Tea", 10000);
      sellBill("2026-11-07T10:00:00.000Z", [{ productId: tea.id }], {
        lineDiscountBps: 1000,
        billDiscountBps: 1000,
      });
      expect(service.salesByProduct(day).rows[0]).toMatchObject({ grossPaisa: 8100 });
      expect(service.salesByDay(day).rows[0]).toMatchObject({ grossPaisa: 8100, netPaisa: 8100 });
    });

    it("shows a linked partial return on the refund's day", () => {
      const tea = product("Tea", 10000);
      const sale = sellBill("2026-11-06T10:00:00.000Z", [{ productId: tea.id, qtyMilli: 3000 }]);
      refund("2026-11-07T10:00:00.000Z", sale.id, "Tea", 1000, 10000);

      expect(service.salesByProduct(range("2026-11-06")).rows[0]).toMatchObject({
        pieceQtyMilli: 3000,
        grossPaisa: 30000,
        returnsPaisa: 0,
      });
      expect(service.salesByProduct(day).rows[0]).toMatchObject({
        pieceQtyMilli: -1000,
        grossPaisa: 0,
        returnsPaisa: 10000,
        netPaisa: -10000,
      });
    });

    it("splits an exchange bill into gross and returns and agrees across reports", () => {
      const tea = product("Tea", 10000);
      const soap = product("Soap", 4000);
      const sale = sellBill("2026-11-06T10:00:00.000Z", [{ productId: tea.id }]);
      clock = new Date("2026-11-07T10:00:00.000Z");
      okBill(
        kit.returns.addFromSale({
          saleId: sale.id,
          lines: [{ saleLineId: lineOf(sale.id, "Tea").id, qtyMilli: 1000 }],
        }),
      );
      const bill = okBill(kit.billDrafts.addProduct({ productId: soap.id }));
      okSale(
        sellingService.complete({
          draftId: bill.id,
          payments: [{ method: "cash", amountPaisa: 6000 }],
        }),
      );

      const byDay = service.salesByDay(day).totals;
      const byProduct = service.salesByProduct(day).totals;
      expect(byProduct).toMatchObject({ grossPaisa: 4000, returnsPaisa: 10000, netPaisa: -6000 });
      expect(service.salesByCategory(day).totals.netPaisa).toBe(byDay.netPaisa);
      expect(service.salesByCashier(day).totals).toMatchObject({
        billCount: 1,
        grossPaisa: 4000,
        returnsPaisa: 10000,
        netPaisa: byDay.netPaisa,
      });
      expect(byDay).toMatchObject({ grossPaisa: 4000, returnsPaisa: 10000, netPaisa: -6000 });
    });

    it("reports weighed lines in kg and pack barcodes in base pieces", () => {
      const rice = product("Rice", 35400, { unit: "kg" });
      const cola = product("Cola", 1000);
      kit.addBarcode(cola.id, "6001", { packQtyMilli: 12000 });
      sellBill("2026-11-07T10:00:00.000Z", [{ productId: rice.id, qtyMilli: 1250 }]);
      clock = new Date("2026-11-07T10:05:00.000Z");
      const bill = okBill(kit.billDrafts.scan({ barcode: "6001" }));
      okSale(
        sellingService.complete({
          draftId: bill.id,
          payments: [{ method: "cash", amountPaisa: 100000 }],
        }),
      );

      const rows = service.salesByProduct(day).rows;
      const riceRow = rows.find((row) => row.product === "Rice")!;
      expect(riceRow).toMatchObject({ kgQtyMilli: 1250, grossPaisa: 44250 });
      expect(formatReportCell(salesByProductColumns[2]!, riceRow.kgQtyMilli)).toBe("1.250 kg");
      expect(rows.find((row) => row.product === "Cola")).toMatchObject({
        pieceQtyMilli: 12000,
        grossPaisa: 12000,
      });
    });

    it("never changes after the catalog is edited", () => {
      const tea = product("Tea", 10000);
      const grocery = newCategory("Grocery");
      db().update(products).set({ categoryId: grocery.id }).where(eq(products.id, tea.id)).run();
      sellBill("2026-11-07T10:00:00.000Z", [{ productId: tea.id }]);
      const before = {
        product: service.salesByProduct(day),
        category: service.salesByCategory(day),
      };

      const household = newCategory("Household");
      db()
        .update(products)
        .set({ nameEn: "Renamed", categoryId: household.id })
        .where(eq(products.id, tea.id))
        .run();
      db()
        .update(categories)
        .set({ name: "Gone", deletedAt: new Date() })
        .where(eq(categories.id, grocery.id))
        .run();

      expect(service.salesByProduct(day)).toEqual(before.product);
      expect(service.salesByCategory(day)).toEqual(before.category);
      expect(before.category.rows[0]?.category).toBe("Grocery");

      sellBill("2026-11-07T11:00:00.000Z", [{ productId: tea.id }]);
      expect(
        service
          .salesByCategory(day)
          .rows.map((row) => row.category)
          .toSorted(),
      ).toEqual(["Grocery", "Household"]);
    });

    it("groups misc lines in one last row and out of the categories", () => {
      kit.setMiscEnabled(true);
      const tea = product("Tea", 10000);
      sellBill("2026-11-07T10:00:00.000Z", [{ productId: tea.id }]);
      for (const [name, price] of [
        ["Loose sweets", 5000],
        ["Candles", 90000],
      ] as const) {
        clock = new Date("2026-11-07T10:10:00.000Z");
        const bill = okBill(kit.billDrafts.addMisc({ name, pricePaisa: price }));
        okSale(
          sellingService.complete({
            draftId: bill.id,
            payments: [{ method: "cash", amountPaisa: price }],
          }),
        );
      }

      const byProduct = service.salesByProduct(day);
      expect(byProduct.rows.map((row) => row.product)).toEqual(["Tea", "Misc items"]);
      expect(byProduct.rows[1]).toMatchObject({ grossPaisa: 80508, pieceQtyMilli: 2000 });
      expect(byProduct.totals.grossPaisa).toBe(90508);
      const byCategory = service.salesByCategory(day);
      expect(byCategory.rows).toHaveLength(2);
      expect(byCategory.rows[1]).toMatchObject({ category: "Misc items", grossPaisa: 80508 });
      expect(byCategory.totals.netPaisa).toBe(service.salesByDay(day).totals.netPaisa);
    });

    it("credits each bill to whoever rang it and counts deactivated users", () => {
      const tea = product("Tea", 10000);
      const first = sellBill("2026-11-07T10:00:00.000Z", [{ productId: tea.id, qtyMilli: 2000 }]);
      const other = kit.signIn("second");
      refund("2026-11-07T11:00:00.000Z", first.id, "Tea", 1000, 10000);
      sellBill("2026-11-07T12:00:00.000Z", [{ productId: tea.id }]);
      db()
        .update(users)
        .set({ isActive: false, deletedAt: new Date() })
        .where(eq(users.id, other.id))
        .run();

      const { rows, totals } = service.salesByCashier(day);

      expect(rows).toEqual([
        {
          cashier: "cashier name",
          billCount: 1,
          grossPaisa: 20000,
          returnsPaisa: 0,
          netPaisa: 20000,
        },
        {
          cashier: "second name",
          billCount: 2,
          grossPaisa: 10000,
          returnsPaisa: 10000,
          netPaisa: 0,
        },
      ]);
      expect(totals.billCount).toBe(3);
    });

    it("keeps rounding in a footer row and ties net to sales by day", () => {
      db().update(stores).set({ cashRoundingEnabled: true, cashRoundingPaisa: 100 }).run();
      const soap = product("Soap", 15050, { taxCategoryId: standard() });
      sellBill("2026-11-07T10:00:00.000Z", [{ productId: soap.id, qtyMilli: 3000 }]);

      const byDay = service.salesByDay(day).totals;
      expect(byDay.roundingPaisa).not.toBe(0);
      for (const result of [
        service.salesByProduct(day),
        service.salesByCategory(day),
        service.salesByCashier(day),
      ]) {
        expect(result.totals.netPaisa).toBe(byDay.netPaisa);
        expect(result.footer).toEqual([
          { label: "Rounding", values: { netPaisa: byDay.roundingPaisa } },
        ]);
        expect(result.totals.netPaisa + byDay.roundingPaisa + byDay.taxPaisa).toBe(
          byDay.totalPaisa,
        );
      }
    });

    it("has no footer when rounding is off", () => {
      sellBill("2026-11-07T10:00:00.000Z", [{ productId: product("Tea", 10000).id }]);
      expect(service.salesByProduct(day).footer).toEqual([]);
      expect(service.salesByCategory(day).footer).toEqual([]);
      expect(service.salesByCashier(day).footer).toEqual([]);
    });

    it("splits at Karachi midnight and excludes another store", () => {
      const tea = product("Tea", 10000);
      sellBill("2026-11-06T18:59:59.000Z", [{ productId: tea.id }]);
      sellBill("2026-11-06T19:00:00.000Z", [{ productId: tea.id }]);
      expect(service.salesByProduct(range("2026-11-06")).totals.grossPaisa).toBe(10000);
      expect(service.salesByProduct(day).totals.grossPaisa).toBe(10000);

      const other = db().insert(stores).values({}).returning().get();
      kit.database.sqlite.pragma("foreign_keys = OFF");
      kit.database.sqlite.prepare("UPDATE sales SET store_id = ?").run(other.id);
      kit.database.sqlite.pragma("foreign_keys = ON");
      expect(service.salesByProduct(range("2026-11-06", "2026-11-07")).rows).toEqual([]);
      expect(service.salesByCashier(range("2026-11-06", "2026-11-07")).rows).toEqual([]);
    });

    it("requires a session", () => {
      kit.sessions.end();
      expect(() => service.salesByProduct(day)).toThrow(UnauthenticatedError);
      expect(() => service.salesByCategory(day)).toThrow(UnauthenticatedError);
      expect(() => service.salesByCashier(day)).toThrow(UnauthenticatedError);
    });

    describe("export", () => {
      beforeEach(() => {
        db().update(stores).set({ cashRoundingEnabled: true, cashRoundingPaisa: 100 }).run();
        sellBill("2026-11-07T10:00:00.000Z", [
          { productId: product("Soap", 15050, { taxCategoryId: standard() }).id },
        ]);
      });

      const cases = [
        [
          "exportSalesByProduct",
          "Sales by product",
          "sales-by-product",
          "Product,Pieces,Kg,Litres,Gross sales,Returns,Net sales",
          7,
        ],
        [
          "exportSalesByCategory",
          "Sales by category",
          "sales-by-category",
          "Category,Pieces,Kg,Litres,Gross sales,Returns,Net sales",
          7,
        ],
        [
          "exportSalesByCashier",
          "Sales by cashier",
          "sales-by-cashier",
          "Cashier,Bills,Gross sales,Returns,Net sales",
          5,
        ],
      ] as const;

      it.each(cases)(
        "%s writes a CSV with Total and Rounding",
        async (method, _title, stem, header) => {
          const result = await service[method]({
            range: range("2026-11-01", "2026-11-07"),
            format: "csv",
          });
          const name = `${stem}-2026-11-01-to-2026-11-07.csv`;
          expect(result).toEqual({ ok: true, status: "saved", path: join(kit.dir, name) });
          const lines = readFileSync(join(kit.dir, name), "utf8").slice(1).split("\r\n");
          expect(lines[0]).toBe(header);
          expect(lines.at(-3)?.startsWith("Total,")).toBe(true);
          expect(lines.at(-2)?.startsWith("Rounding,")).toBe(true);
        },
      );

      it.each(cases)("%s builds the PDF model", async (method, title, _stem, _header, columns) => {
        await service[method]({ range: range("2026-11-07"), format: "pdf" });
        const model = toPdf.mock.calls[0]![0];
        expect(model.title).toBe(title);
        expect(model.columns).toHaveLength(columns);
      });

      it.each(cases)("%s returns cancelled", async (method) => {
        chooseSavePath.mockResolvedValueOnce(null);
        expect(await service[method]({ range: range("2026-11-07"), format: "csv" })).toEqual({
          ok: true,
          status: "cancelled",
        });
      });
    });
  });
});
