import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentModel } from "../../shared/document";
import type { ReportExportFormat } from "../../shared/reports";
import { reportDetailLimit } from "../../shared/discounts-returns-voids";
import type { Bill, BillResult, CompleteSaleResult } from "../../shared/checkout";
import { UnauthenticatedError } from "../auth/errors";
import { stores } from "../db/schema";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { createReportsService } from "./reports";
import { shiftSalesSummary } from "./shift-sales";

const okBill = (result: BillResult): Bill => {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.bill;
};

const okSale = (result: CompleteSaleResult) => {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.sale;
};

const range = (from: string, to = from) => ({ from, to });
const day = range("2026-11-07");
const at = (iso: string) => vi.setSystemTime(new Date(iso));

describe("discounts, returns and voids", () => {
  let kit: CheckoutKit;
  let service: ReturnType<typeof createReportsService>;
  let shiftId: string;
  let toPdf: ReturnType<typeof vi.fn<(model: DocumentModel) => Promise<Buffer>>>;
  let chooseSavePath: ReturnType<
    typeof vi.fn<(name: string, format: ReportExportFormat) => Promise<string | null>>
  >;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-07T08:00:00.000Z"));
    kit = createCheckoutKit();
    kit.signIn("cashier");
    shiftId = kit.openShift();
    kit.setMiscEnabled(true);
    toPdf = vi.fn(async () => Buffer.from("%PDF-1.4 fake"));
    chooseSavePath = vi.fn(async (name: string) => join(kit.dir, name));
    service = createReportsService({
      database: kit.database,
      sessions: kit.sessions,
      renderer: { toPdf, print: async () => "printed" },
      chooseSavePath,
    });
  });

  afterEach(() => {
    kit.close();
    vi.useRealTimers();
  });

  const product = (name: string, salePricePaisa: number) =>
    kit.addProduct({
      nameEn: name,
      searchText: name.toLowerCase(),
      salePricePaisa,
      taxCategoryId: kit.taxCategoryId("Exempt"),
    });

  const strayFiles = () => readdirSync(kit.dir).filter((name) => !name.startsWith("vendora.db"));

  const pay = (bill: Bill, amountPaisa = 1_000_000) =>
    okSale(kit.sales.complete({ draftId: bill.id, payments: [{ method: "cash", amountPaisa }] }));

  const lineIdOf = (saleId: string) =>
    (
      kit.database.sqlite.prepare("SELECT id FROM sale_lines WHERE sale_id = ?").get(saleId) as {
        id: string;
      }
    ).id;

  function seedScenario() {
    const tea = product("Tea", 10000);
    const soap = product("Soap", 5000);

    at("2026-11-07T08:00:00.000Z");
    let bill = okBill(kit.billDrafts.addProduct({ productId: tea.id, qtyMilli: 2000 }));
    bill = okBill(
      kit.billDrafts.setBillDiscount({
        draftId: bill.id,
        discount: { kind: "amount", amountPaisa: 1000 },
      }),
    );
    const billDiscountSale = pay(bill);

    at("2026-11-07T08:10:00.000Z");
    bill = okBill(kit.billDrafts.addProduct({ productId: tea.id }));
    bill = okBill(
      kit.billDrafts.updateLine({
        lineId: bill.lines[0]!.id,
        discount: { kind: "amount", amountPaisa: 500 },
      }),
    );
    bill = okBill(kit.billDrafts.addProduct({ productId: soap.id }));
    bill = okBill(kit.billDrafts.deleteLine({ lineId: bill.lines[1]!.id }));
    const lineDiscountSale = pay(bill);

    at("2026-11-07T08:20:00.000Z");
    bill = okBill(
      kit.returns.addFromSale({
        saleId: billDiscountSale.id,
        lines: [{ saleLineId: lineIdOf(billDiscountSale.id), qtyMilli: 1000 }],
      }),
    );
    const shelfReturn = okSale(
      kit.sales.complete({ draftId: bill.id, payments: [{ method: "cash", amountPaisa: 9500 }] }),
    );

    at("2026-11-07T08:30:00.000Z");
    bill = okBill(
      kit.returns.addFromSale({
        saleId: lineDiscountSale.id,
        lines: [{ saleLineId: lineIdOf(lineDiscountSale.id), qtyMilli: 1000 }],
      }),
    );
    bill = okBill(kit.billDrafts.setDamaged({ lineId: bill.lines[0]!.id, damaged: true }));
    okSale(
      kit.sales.complete({ draftId: bill.id, payments: [{ method: "cash", amountPaisa: 9500 }] }),
    );

    at("2026-11-07T08:40:00.000Z");
    bill = okBill(kit.billDrafts.addProduct({ productId: soap.id }));
    bill = okBill(kit.billDrafts.toggleReturn({ lineId: bill.lines[0]!.id }));
    okSale(
      kit.sales.complete({ draftId: bill.id, payments: [{ method: "cash", amountPaisa: 5000 }] }),
    );

    at("2026-11-07T08:50:00.000Z");
    bill = okBill(
      kit.billDrafts.addMisc({ name: "Loose sugar", pricePaisa: 3000, isReturn: true }),
    );
    okSale(
      kit.sales.complete({ draftId: bill.id, payments: [{ method: "cash", amountPaisa: 3000 }] }),
    );

    at("2026-11-07T09:00:00.000Z");
    bill = okBill(kit.billDrafts.addProduct({ productId: tea.id }));
    bill = okBill(kit.billDrafts.addProduct({ productId: soap.id }));
    const discardedLine = bill.lines[1]!.id;
    bill = okBill(kit.billDrafts.deleteLine({ lineId: discardedLine }));
    at("2026-11-07T09:05:00.000Z");
    kit.billDrafts.discard({ draftId: bill.id });

    at("2026-11-07T09:10:00.000Z");
    bill = okBill(kit.billDrafts.addProduct({ productId: tea.id }));
    bill = okBill(kit.billDrafts.addProduct({ productId: soap.id }));
    bill = okBill(kit.billDrafts.deleteLine({ lineId: bill.lines[1]!.id }));
    kit.billDrafts.hold({ draftId: bill.id });

    at("2026-11-07T09:20:00.000Z");
    const emptied = okBill(kit.billDrafts.addProduct({ productId: soap.id }));
    okBill(kit.billDrafts.deleteLine({ lineId: emptied.lines[0]!.id }));
    okBill(kit.billDrafts.resume({ draftId: bill.id }));

    return { billDiscountSale, lineDiscountSale, shelfReturn, tea, soap };
  }

  it("agrees with the Z-report for the same shift", () => {
    seedScenario();

    const result = service.discountsReturnsVoids(day);
    const z = shiftSalesSummary(kit.database.db, shiftId);

    expect(result.discounts.billCount).toBe(z.discounts.count);
    expect(result.discounts.discountPaisa).toBe(z.discounts.amountPaisa);
    expect(result.returns.lineCount).toBe(z.refunds.count);
    expect(result.returns.valuePaisa).toBe(z.refunds.amountPaisa);
    expect(result.voids.deletedLines.count).toBe(z.deletedLines.count);
    expect(result.voids.discardedBills.count).toBe(z.discardedBills.count);
    expect(result.discounts.billCount).toBe(4);
    expect(result.voids.discardedBills.count).toBe(1);
  });

  it("lists discounts by user and by bill, newest first", () => {
    const { billDiscountSale, lineDiscountSale } = seedScenario();

    const { discounts } = service.discountsReturnsVoids(day);

    expect(discounts.byUser).toMatchObject([
      { userName: "cashier name", billCount: 4, discountPaisa: 500 },
    ]);
    expect(discounts.bills.map((bill) => [bill.invoiceNo, bill.discountPaisa])).toEqual([
      ["T1-000004", -500],
      ["T1-000003", -500],
      [lineDiscountSale.invoiceNo, 500],
      [billDiscountSale.invoiceNo, 1000],
    ]);
  });

  it("counts returns without a receipt separately from returns with one", () => {
    seedScenario();

    const { returns } = service.discountsReturnsVoids(day);
    const summary = Object.fromEntries(returns.summary.map((row) => [row.kind, row]));
    const audited = kit.database.sqlite
      .prepare(
        "SELECT coalesce(sum(json_extract(details, '$.lineCount')), 0) AS n FROM audit_log WHERE action = 'return_without_receipt'",
      )
      .get() as { n: number };

    expect(returns.summary.map((row) => row.kind)).toEqual([
      "with-receipt",
      "without-receipt",
      "back-to-shelf",
      "damaged",
    ]);
    expect(summary["with-receipt"]).toMatchObject({ lineCount: 2, valuePaisa: 19000 });
    expect(summary["without-receipt"]).toMatchObject({ lineCount: 2, valuePaisa: 8000 });
    expect(summary["without-receipt"]!.lineCount).toBe(audited.n);
    expect(summary["back-to-shelf"]).toMatchObject({ lineCount: 2, valuePaisa: 14500 });
    expect(summary.damaged).toMatchObject({ lineCount: 1, valuePaisa: 9500 });
    expect(returns.lines.map((line) => line.disposition)).toEqual([
      "no-stock",
      "back-to-shelf",
      "damaged",
      "back-to-shelf",
    ]);
    expect(returns.lines.map((line) => line.receiptInvoiceNo !== null)).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(returns.lines[0]).toMatchObject({ itemName: "Loose sugar", userName: "cashier name" });
  });

  it("includes discarded bills and leaves out the emptied one", () => {
    seedScenario();

    const { voids } = service.discountsReturnsVoids(day);

    expect(voids.discardedBills.rows).toHaveLength(1);
    expect(voids.discardedBills.rows[0]).toMatchObject({ lineCount: 1, totalPaisa: 10000 });
    expect(voids.discardedBills.totalPaisa).toBe(10000);
    const discardedLine = voids.deletedLines.rows.find((row) => row.billState === "discarded");
    expect(discardedLine).toMatchObject({ itemName: "Soap", invoiceNo: null, grossPaisa: 5000 });
  });

  it("values a deleted line at its gross and links the sold bill", () => {
    const { lineDiscountSale } = seedScenario();

    const { voids } = service.discountsReturnsVoids(day);

    const sold = voids.deletedLines.rows.find((row) => row.billState === "sold");
    expect(sold).toMatchObject({
      itemName: "Soap",
      unit: "piece",
      qtyMilli: 1000,
      invoiceNo: lineDiscountSale.invoiceNo,
      grossPaisa: 5000,
    });
    expect(voids.deletedLines.rows.map((row) => row.billState).toSorted()).toEqual([
      "discarded",
      "discarded",
      "not-completed",
      "sold",
    ]);
    expect(voids.deletedLines.grossPaisa).toBe(20000);
  });

  it("values a deleted line with a line discount before the discount", () => {
    const tea = product("Tea", 10000);
    let bill = okBill(kit.billDrafts.addProduct({ productId: tea.id }));
    bill = okBill(
      kit.billDrafts.updateLine({
        lineId: bill.lines[0]!.id,
        discount: { kind: "amount", amountPaisa: 2500 },
      }),
    );
    okBill(kit.billDrafts.deleteLine({ lineId: bill.lines[0]!.id }));

    const { voids } = service.discountsReturnsVoids(day);

    expect(voids.deletedLines.rows[0]!.grossPaisa).toBe(10000);
  });

  it("puts entries around a Karachi midnight on the right days", () => {
    const tea = product("Tea", 10000);
    const discounted = (iso: string) => {
      at(iso);
      let bill = okBill(kit.billDrafts.addProduct({ productId: tea.id }));
      bill = okBill(
        kit.billDrafts.setBillDiscount({
          draftId: bill.id,
          discount: { kind: "amount", amountPaisa: 100 },
        }),
      );
      return pay(bill);
    };
    discounted("2026-11-07T18:59:00.000Z");
    discounted("2026-11-07T19:00:00.000Z");
    at("2026-11-07T19:00:00.000Z");
    const bill = okBill(kit.billDrafts.addProduct({ productId: tea.id }));
    kit.billDrafts.discard({ draftId: bill.id });

    const first = service.discountsReturnsVoids(day);
    const second = service.discountsReturnsVoids(range("2026-11-08"));

    expect([first.discounts.billCount, first.voids.discardedBills.count]).toEqual([1, 0]);
    expect([second.discounts.billCount, second.voids.discardedBills.count]).toEqual([1, 1]);
  });

  it("caps the rows but not the totals", { timeout: 60_000 }, () => {
    const tea = product("Tea", 10000);
    for (let index = 0; index < reportDetailLimit + 5; index++) {
      at(
        `2026-11-07T10:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
      );
      let bill = okBill(kit.billDrafts.addProduct({ productId: tea.id }));
      bill = okBill(
        kit.billDrafts.setBillDiscount({
          draftId: bill.id,
          discount: { kind: "amount", amountPaisa: 100 },
        }),
      );
      pay(bill);
    }

    const { discounts } = service.discountsReturnsVoids(day);

    expect(discounts.bills).toHaveLength(reportDetailLimit);
    expect(discounts.billCount).toBe(reportDetailLimit + 5);
    expect(discounts.discountPaisa).toBe((reportDetailLimit + 5) * 100);
  });

  it("keeps other stores out", () => {
    seedScenario();
    const other = kit.database.db.insert(stores).values({ name: "Other" }).returning().get();
    kit.sessions.start({
      userId: kit.sessions.current()!.userId,
      storeId: other.id,
      loggedInAt: new Date(0),
    });

    const result = service.discountsReturnsVoids(day);

    expect(result.discounts.billCount).toBe(0);
    expect(result.returns.lineCount).toBe(0);
    expect(result.voids.deletedLines.count).toBe(0);
  });

  it("needs a session", () => {
    kit.sessions.end();

    expect(() => service.discountsReturnsVoids(day)).toThrow(UnauthenticatedError);
  });

  describe("export", () => {
    it("writes every row to the CSV as titled blocks in store time", async () => {
      seedScenario();

      const result = await service.exportDiscountsReturnsVoids({ range: day, format: "csv" });

      const path = join(kit.dir, "discounts-returns-voids-2026-11-07.csv");
      expect(result).toEqual({ ok: true, status: "saved", path });
      const text = readFileSync(path, "utf8");
      const titles = text
        .slice(1)
        .split("\r\n")
        .filter((line) =>
          [
            "Discounts by user",
            "Discounted bills",
            "Returns summary",
            "Returned lines",
            "Deleted lines",
            "Discarded bills",
          ].includes(line),
        );
      expect(titles).toHaveLength(6);
      expect(text).toContain("Invoice,Time,User,Bill total,Discount\r\n");
      expect(text).toContain("Time,User,Item,Qty,Bill,Gross before discount\r\n");
      expect(text).toContain("T1-000004,2026-11-07 13:30,");
      expect(text).toContain("Without receipt");
      expect(text).toContain(",Discarded,");
      expect(text).toContain(",Not completed,");
    });

    it("writes rows beyond the screen cap to the CSV only", async () => {
      const tea = product("Tea", 10000);
      for (let index = 0; index < reportDetailLimit + 3; index++) {
        at(
          `2026-11-07T10:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
        );
        const bill = okBill(kit.billDrafts.addProduct({ productId: tea.id }));
        okBill(kit.billDrafts.deleteLine({ lineId: bill.lines[0]!.id }));
      }

      await service.exportDiscountsReturnsVoids({ range: day, format: "csv" });
      await service.exportDiscountsReturnsVoids({ range: day, format: "pdf" });

      const csv = readFileSync(join(kit.dir, "discounts-returns-voids-2026-11-07.csv"), "utf8");
      expect(csv.split("\r\n").filter((line) => line.includes(",Tea,"))).toHaveLength(
        reportDetailLimit + 3,
      );
      const deleted = toPdf.mock.calls[0]![0].sections!.find(
        (section) => section.heading === "Deleted lines",
      )!;
      expect(deleted.rows).toHaveLength(reportDetailLimit);
      expect(deleted.note).toBe(
        `Showing the latest ${reportDetailLimit} of ${reportDetailLimit + 3}. The CSV export has every row.`,
      );
    }, 60_000);

    it("renders the PDF as sections from database rows", async () => {
      seedScenario();

      const result = await service.exportDiscountsReturnsVoids({ range: day, format: "pdf" });

      expect(result).toMatchObject({ ok: true, status: "saved" });
      expect(readFileSync(join(kit.dir, "discounts-returns-voids-2026-11-07.pdf"), "utf8")).toBe(
        "%PDF-1.4 fake",
      );
      const model = toPdf.mock.calls[0]![0];
      expect(model).toMatchObject({
        title: "Discounts, returns and voids",
        landscape: true,
        columns: [],
      });
      expect(model.sections!.map((section) => [section.heading, section.note])).toEqual([
        ["Discounts by user", null],
        ["Discounted bills", null],
        ["Returns summary", null],
        ["Returned lines", null],
        ["Deleted lines", null],
        ["Discarded bills", null],
      ]);
    });

    it("returns cancelled and writes nothing when the dialog is cancelled", async () => {
      chooseSavePath.mockResolvedValueOnce(null);

      expect(await service.exportDiscountsReturnsVoids({ range: day, format: "csv" })).toEqual({
        ok: true,
        status: "cancelled",
      });
      expect(strayFiles()).toEqual([]);
    });

    it("returns failed and leaves no file when rendering fails", async () => {
      toPdf.mockRejectedValueOnce(new Error("render"));

      const result = await service.exportDiscountsReturnsVoids({ range: day, format: "pdf" });

      expect(result).toEqual({
        ok: false,
        reason: "failed",
        message: "Couldn't save the report. Check the folder and try again.",
      });
      expect(strayFiles()).toEqual([]);
    });

    it("returns failed when the folder cannot be written", async () => {
      chooseSavePath.mockResolvedValueOnce(join(kit.dir, "missing", "report.csv"));

      const result = await service.exportDiscountsReturnsVoids({ range: day, format: "csv" });

      expect(result).toMatchObject({ ok: false, reason: "failed" });
      expect(existsSync(join(kit.dir, "missing"))).toBe(false);
    });

    it("throws when signed out before the dialog", async () => {
      kit.sessions.end();

      await expect(
        service.exportDiscountsReturnsVoids({ range: day, format: "csv" }),
      ).rejects.toThrow(UnauthenticatedError);
      expect(chooseSavePath).not.toHaveBeenCalled();
    });
  });
});
