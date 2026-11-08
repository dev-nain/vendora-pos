import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bill, BillResult, CompleteSaleResult } from "../../shared/checkout";
import type { DocumentModel } from "../../shared/document";
import type { ReportExportFormat } from "../../shared/reports";
import { UnauthenticatedError } from "../auth/errors";
import { categories, products, stores } from "../db/schema";
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
const day = "2026-11-07";
const morning = "2026-11-07T08:00:00.000Z";

describe("gross profit reports", () => {
  let kit: CheckoutKit;
  let clock: Date;
  let service: ReturnType<typeof createReportsService>;
  let toPdf: ReturnType<typeof vi.fn<(model: DocumentModel) => Promise<Buffer>>>;
  let chooseSavePath: ReturnType<
    typeof vi.fn<(name: string, format: ReportExportFormat) => Promise<string | null>>
  >;
  let sellingService: ReturnType<typeof createSalesService>;

  beforeEach(() => {
    kit = createCheckoutKit();
    kit.signIn("cashier");
    kit.openShift();
    clock = new Date(morning);
    sellingService = createSalesService({
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

  const product = (name: string, salePricePaisa: number, costPaisa: number, overrides = {}) =>
    kit.addProduct({
      nameEn: name,
      searchText: name.toLowerCase(),
      salePricePaisa,
      costPaisa,
      taxCategoryId: kit.taxCategoryId("Exempt"),
      ...overrides,
    });

  const complete = (bill: Bill, paid = 1000000) =>
    okSale(
      sellingService.complete({
        draftId: bill.id,
        payments: [{ method: "cash", amountPaisa: paid }],
      }),
    );

  function sell(at: string, items: { productId: string; qtyMilli?: number }[], paid = 1000000) {
    clock = new Date(at);
    let bill: Bill | undefined;
    for (const item of items) bill = okBill(kit.billDrafts.addProduct(item));
    return complete(bill!, paid);
  }

  const sellOne = (productId: string, qtyMilli = 1000, at = morning) =>
    sell(at, [{ productId, qtyMilli }]);

  function returnLine(at: string, saleId: string, qtyMilli: number, paid: number) {
    const line = kit.database.sqlite
      .prepare("SELECT id FROM sale_lines WHERE sale_id = ?")
      .get(saleId) as { id: string };
    clock = new Date(at);
    const bill = okBill(
      kit.returns.addFromSale({ saleId, lines: [{ saleLineId: line.id, qtyMilli }] }),
    );
    return complete(bill, paid);
  }

  function sellWithMisc() {
    kit.setMiscEnabled(true);
    const tea = product("Tea", 10000, 6000);
    clock = new Date(morning);
    okBill(kit.billDrafts.addProduct({ productId: tea.id, qtyMilli: 1000 }));
    okBill(kit.billDrafts.addMisc({ name: "Loose sweets", pricePaisa: 11800 }));
    const bill = okBill(kit.billDrafts.addMisc({ name: "Candles", pricePaisa: 5900 }));
    complete(bill);
  }

  const miscNet = () =>
    (
      kit.database.sqlite
        .prepare(
          "SELECT sum(total_paisa - tax_paisa) AS n FROM sale_lines WHERE name_en IN ('Loose sweets', 'Candles')",
        )
        .get() as { n: number }
    ).n;

  const sellRounded = () => {
    db().update(stores).set({ cashRoundingEnabled: true, cashRoundingPaisa: 100 }).run();
    sellOne(product("Soap", 15050, 10000).id);
  };

  function sellScenario() {
    kit.setMiscEnabled(true);
    db().update(stores).set({ cashRoundingEnabled: true, cashRoundingPaisa: 100 }).run();
    const items = [
      { productId: product("Tea", 10000, 6000).id },
      { productId: product("Loss maker", 5000, 8000).id },
      { productId: product("Soap", 15050, 10000).id },
    ];
    clock = new Date(morning);
    let bill: Bill | undefined;
    for (const item of items) bill = okBill(kit.billDrafts.addProduct(item));
    bill = okBill(kit.billDrafts.addMisc({ name: "Loose sweets", pricePaisa: 17700 }));
    complete(bill);
  }

  const roundingCell = () =>
    service.salesByDay(range(day)).totals.roundingPaisa < 0 ? "-0.50" : "0.50";

  const byProduct = (r = range(day)) => service.grossProfitByProduct(r);
  const byCategory = (r = range(day)) => service.grossProfitByCategory(r);

  describe("net sales and cost", () => {
    it("excludes tax in a tax-inclusive store", () => {
      const tea = product("Tea", 11800, 6000, { taxCategoryId: kit.taxCategoryId("Standard") });
      sellOne(tea.id, 2000);

      const result = byProduct();

      expect(result.rows).toEqual([
        {
          product: "Tea",
          pieceQtyMilli: 2000,
          kgQtyMilli: 0,
          litreQtyMilli: 0,
          netPaisa: 20000,
          costPaisa: 12000,
          grossProfitPaisa: 8000,
          marginBps: 4000,
        },
      ]);
      expect(result.totals.netPaisa).toBe(service.salesByDay(range(day)).totals.netPaisa);
      expect(result.footer).toEqual([]);
    });

    it("gives the same figures in a tax-exclusive store", () => {
      db().update(stores).set({ pricesIncludeTax: false }).run();
      const tea = product("Tea", 10000, 6000, { taxCategoryId: kit.taxCategoryId("Standard") });
      sellOne(tea.id, 2000);

      const result = byProduct();

      expect(result.rows[0]).toMatchObject({
        netPaisa: 20000,
        costPaisa: 12000,
        grossProfitPaisa: 8000,
        marginBps: 4000,
      });
      expect(service.salesByDay(range(day)).totals.taxPaisa).toBe(3600);
      expect(result.totals.netPaisa).toBe(service.salesByDay(range(day)).totals.netPaisa);
    });

    it("reduces net sales by line and bill discounts and leaves cost alone", () => {
      const tea = product("Tea", 10000, 6000);
      clock = new Date(morning);
      const bill = okBill(kit.billDrafts.addProduct({ productId: tea.id, qtyMilli: 2000 }));
      okBill(
        kit.billDrafts.updateLine({
          lineId: bill.lines[0]!.id,
          discount: { kind: "percent", bps: 1000 },
        }),
      );
      okBill(
        kit.billDrafts.setBillDiscount({
          draftId: bill.id,
          discount: { kind: "amount", amountPaisa: 1000 },
        }),
      );
      complete(bill);

      expect(byProduct().rows[0]).toMatchObject({ netPaisa: 17000, costPaisa: 12000 });
    });

    it("counts weighed quantity in the Kg column", () => {
      const rice = product("Rice", 35400, 28000, { unit: "kg" });
      sellOne(rice.id, 1250);

      expect(byProduct().rows[0]).toMatchObject({
        kgQtyMilli: 1250,
        pieceQtyMilli: 0,
        costPaisa: 35000,
        netPaisa: 44250,
      });
    });

    it("counts a pack line in base units", () => {
      const tea = product("Tea", 10000, 8000);
      kit.addBarcode(tea.id, "112", { packQtyMilli: 12000, salePricePaisa: 100000 });
      clock = new Date(morning);
      complete(okBill(kit.billDrafts.scan({ barcode: "112" })));

      expect(byProduct().rows[0]).toMatchObject({
        pieceQtyMilli: 12000,
        costPaisa: 96000,
        netPaisa: 100000,
      });
    });

    it("rounds cost per line so products sum to categories and totals", () => {
      const names = ["Atta", "Besan", "Chana"];
      for (const name of names) sellOne(product(name, 1000, 3, { unit: "kg" }).id, 500);

      const productRows = byProduct();
      const category = byCategory();

      expect(productRows.rows.map((row) => row.costPaisa)).toEqual([2, 2, 2]);
      expect(productRows.totals.costPaisa).toBe(6);
      expect(category.rows).toHaveLength(1);
      expect(category.rows[0]).toMatchObject({ costPaisa: 6, netPaisa: 1500 });
      expect(category.totals).toEqual(productRows.totals);
    });
  });

  describe("returns", () => {
    it("reduces quantity, net and cost for a partial return", () => {
      const tea = product("Tea", 10000, 8000);
      const sale = sellOne(tea.id, 3000);
      returnLine(morning, sale.id, 1000, 10000);

      expect(byProduct().rows[0]).toMatchObject({
        pieceQtyMilli: 2000,
        netPaisa: 20000,
        costPaisa: 16000,
        grossProfitPaisa: 4000,
        marginBps: 2000,
      });
    });

    it("keeps a fully returned product as a zero row", () => {
      const tea = product("Tea", 10000, 8000);
      const sale = sellOne(tea.id);
      returnLine(morning, sale.id, 1000, 10000);

      expect(byProduct().rows).toEqual([
        {
          product: "Tea",
          pieceQtyMilli: 0,
          kgQtyMilli: 0,
          litreQtyMilli: 0,
          netPaisa: 0,
          costPaisa: 0,
          grossProfitPaisa: 0,
          marginBps: null,
        },
      ]);
    });

    it("reduces cost at the snapshot cost after the product cost changed", () => {
      const tea = product("Tea", 10000, 8000);
      const sale = sellOne(tea.id, 2000);
      db().update(products).set({ costPaisa: 9500 }).where(eq(products.id, tea.id)).run();
      returnLine(morning, sale.id, 1000, 10000);

      expect(byProduct().rows[0]).toMatchObject({ netPaisa: 10000, costPaisa: 8000 });
    });

    it("shows negative figures for a range holding only the return", () => {
      const tea = product("Tea", 10000, 8000);
      const sale = sellOne(tea.id, 1000, "2026-11-06T08:00:00.000Z");
      returnLine(morning, sale.id, 1000, 10000);

      const result = byProduct();

      expect(result.rows[0]).toMatchObject({
        pieceQtyMilli: -1000,
        netPaisa: -10000,
        costPaisa: -8000,
        grossProfitPaisa: -2000,
        marginBps: 2000,
      });
      expect(result.totals.marginBps).toBe(2000);
    });
  });

  it("does not change when the catalog changes after the sale", () => {
    const tea = product("Tea", 10000, 8000);
    sellOne(tea.id, 2000);
    const before = { product: byProduct(), category: byCategory() };

    const other = db()
      .insert(categories)
      .values({ storeId: kit.storeId, name: "Other" })
      .returning()
      .get();
    db()
      .update(products)
      .set({ costPaisa: 1, nameEn: "Renamed", categoryId: other.id })
      .where(eq(products.id, tea.id))
      .run();
    db()
      .update(categories)
      .set({ name: "Gone", deletedAt: new Date() })
      .where(eq(categories.id, kit.categoryId))
      .run();

    expect(byProduct()).toEqual(before.product);
    expect(byCategory()).toEqual(before.category);
  });

  describe("misc items", () => {
    it("shows one last row with no cost, profit or margin", () => {
      sellWithMisc();

      const result = byProduct();

      expect(result.rows.map((row) => row.product)).toEqual(["Tea", "Misc items (no cost)"]);
      expect(result.rows[1]).toEqual({
        product: "Misc items (no cost)",
        pieceQtyMilli: 2000,
        kgQtyMilli: 0,
        litreQtyMilli: 0,
        netPaisa: miscNet(),
        costPaisa: null,
        grossProfitPaisa: null,
        marginBps: null,
      });
      expect(miscNet()).toBe(15000);
    });

    it("counts misc in net sales but not in cost, profit or margin totals", () => {
      sellWithMisc();

      const { totals } = byProduct();

      expect(totals.netPaisa).toBe(25000);
      expect(totals.pieceQtyMilli).toBe(3000);
      expect(totals.costPaisa).toBe(6000);
      expect(totals.grossProfitPaisa).toBe(4000);
      expect(totals.marginBps).toBe(4000);
    });

    it("shows the same misc row in the category report with no row of its own", () => {
      sellWithMisc();

      const result = byCategory();

      const defaultName = db()
        .select()
        .from(categories)
        .where(eq(categories.id, kit.categoryId))
        .get()!.name;
      expect(result.rows.map((row) => row.category)).toEqual([defaultName, "Misc items (no cost)"]);
      expect(result.rows[1]).toMatchObject({ netPaisa: 15000, costPaisa: null, marginBps: null });
      expect(result.totals).toEqual(byProduct().totals);
    });
  });

  describe("rounding", () => {
    it("shows bill rounding on its own row outside the totals", () => {
      sellRounded();

      const result = byProduct();
      const sales = service.salesByDay(range(day)).totals;

      expect(sales.roundingPaisa).not.toBe(0);
      expect(result.footer).toEqual([
        { label: "Rounding", values: { netPaisa: sales.roundingPaisa } },
      ]);
      expect(result.totals.netPaisa).toBe(sales.netPaisa);
      expect(result.totals.netPaisa + sales.roundingPaisa + sales.taxPaisa).toBe(sales.totalPaisa);
      expect(byCategory().footer).toEqual(result.footer);
    });

    it("has no footer with rounding off", () => {
      sellOne(product("Soap", 15050, 10000).id);
      expect(byProduct().footer).toEqual([]);
    });
  });

  describe("category snapshot", () => {
    it("groups by the category at sale time and labels with the latest name", () => {
      const a = kit.categoryId;
      const b = db()
        .insert(categories)
        .values({ storeId: kit.storeId, name: "Beta" })
        .returning()
        .get();
      const tea = product("Tea", 10000, 6000);
      sellOne(tea.id, 3000, "2026-11-07T08:00:00.000Z");
      db().update(categories).set({ name: "Alpha" }).where(eq(categories.id, a)).run();
      sellOne(tea.id, 1000, "2026-11-07T09:00:00.000Z");
      db().update(products).set({ categoryId: b.id }).where(eq(products.id, tea.id)).run();
      sellOne(tea.id, 1000, "2026-11-07T10:00:00.000Z");

      const result = byCategory();

      expect(result.rows.map((row) => [row.category, row.netPaisa])).toEqual([
        ["Alpha", 40000],
        ["Beta", 10000],
      ]);
      expect(byProduct().rows).toHaveLength(1);
    });
  });

  it("orders by net sales descending, then label, with misc last", () => {
    kit.setMiscEnabled(true);
    sellOne(product("Banana", 5000, 1000).id);
    sellOne(product("Apple", 5000, 1000).id);
    sellOne(product("Zed", 9000, 1000).id);
    clock = new Date(morning);
    complete(okBill(kit.billDrafts.addMisc({ name: "Loose", pricePaisa: 90000 })));

    expect(byProduct().rows.map((row) => row.product)).toEqual([
      "Zed",
      "Apple",
      "Banana",
      "Misc items (no cost)",
    ]);
  });

  it("puts sales on either side of a Karachi midnight on the right days", () => {
    const tea = product("Tea", 10000, 6000);
    sellOne(tea.id, 1000, "2026-11-06T18:59:59.000Z");
    sellOne(tea.id, 1000, "2026-11-06T19:00:00.000Z");
    sellOne(tea.id, 1000, "2026-11-07T18:59:59.999Z");

    expect(byProduct(range("2026-11-06")).rows[0]?.pieceQtyMilli).toBe(1000);
    expect(byProduct(range("2026-11-07")).rows[0]?.pieceQtyMilli).toBe(2000);
    expect(byProduct(range("2026-11-08")).rows).toEqual([]);
  });

  it("gives zero totals and no margin for an empty range", () => {
    const empty = {
      rows: [],
      totals: {
        pieceQtyMilli: 0,
        kgQtyMilli: 0,
        litreQtyMilli: 0,
        netPaisa: 0,
        costPaisa: 0,
        grossProfitPaisa: 0,
        marginBps: null,
      },
      footer: [],
    };
    expect(byProduct()).toEqual(empty);
    expect(byCategory()).toEqual(empty);
  });

  it("requires a session on every function", async () => {
    kit.sessions.end();
    const input = { range: range(day), format: "csv" } as const;
    expect(() => byProduct()).toThrow(UnauthenticatedError);
    expect(() => byCategory()).toThrow(UnauthenticatedError);
    await expect(service.exportGrossProfitByProduct(input)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(service.exportGrossProfitByCategory(input)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  describe("export", () => {
    it("writes the product CSV", async () => {
      sellScenario();

      const result = await service.exportGrossProfitByProduct({ range: range(day), format: "csv" });

      const path = join(kit.dir, `gross-profit-by-product-${day}.csv`);
      expect(result).toEqual({ ok: true, status: "saved", path });
      const text = readFileSync(path, "utf8");
      const lines = text.slice(1).split("\r\n");
      expect(lines[0]).toBe("Product,Pieces,Kg,Litres,Net sales,Cost,Gross profit,Margin");
      expect(lines).toContain("Tea,1,0,0,100.00,60.00,40.00,40.00%");
      expect(lines).toContain("Loss maker,1,0,0,50.00,80.00,-30.00,-60.00%");
      expect(lines).toContain("Misc items (no cost),1,0,0,150.00,,,");
      expect(lines.at(-3)).toMatch(/^Total,/);
      expect(lines.at(-2)).toBe(`Rounding,,,,${roundingCell()},,,`);
    });

    it("writes the category CSV with a range file name", async () => {
      sellScenario();

      await service.exportGrossProfitByCategory({
        range: range("2026-11-01", day),
        format: "csv",
      });

      const text = readFileSync(
        join(kit.dir, "gross-profit-by-category-2026-11-01-to-2026-11-07.csv"),
        "utf8",
      );
      const lines = text.slice(1).split("\r\n");
      expect(lines[0]).toBe("Category,Pieces,Kg,Litres,Net sales,Cost,Gross profit,Margin");
      expect(lines).toContain("Misc items (no cost),1,0,0,150.00,,,");
      expect(lines.at(-2)).toBe(`Rounding,,,,${roundingCell()},,,`);
    });

    it.each([
      ["Product", "Gross profit by product", "exportGrossProfitByProduct"],
      ["Category", "Gross profit by category", "exportGrossProfitByCategory"],
    ] as const)("renders the %s PDF with a Rounding total", async (_label, title, method) => {
      sellScenario();

      const result = await service[method]({ range: range(day), format: "pdf" });

      expect(result).toMatchObject({ ok: true, status: "saved" });
      const model = toPdf.mock.calls[0]![0];
      expect(model).toMatchObject({ title, landscape: true });
      expect(model.columns).toHaveLength(8);
      expect(model.totals.some((total) => total.label === "Rounding")).toBe(true);
    });

    it.each(["exportGrossProfitByProduct", "exportGrossProfitByCategory"] as const)(
      "returns cancelled and writes nothing from %s",
      async (method) => {
        sellScenario();
        chooseSavePath.mockResolvedValueOnce(null);

        expect(await service[method]({ range: range(day), format: "csv" })).toEqual({
          ok: true,
          status: "cancelled",
        });
        expect(toPdf).not.toHaveBeenCalled();
      },
    );
  });
});
