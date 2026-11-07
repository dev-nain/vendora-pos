import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillResult, CompleteSaleResult } from "../../shared/checkout";
import type { DocumentModel } from "../../shared/document";
import { invoiceMessages } from "../../shared/invoices";
import { formatRupees } from "../../shared/money";
import { UnauthenticatedError } from "../auth/errors";
import { products, saleLines, sales, stores, terminals } from "../db/schema";
import type { DocumentPrintOutcome } from "../documents/document-window";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { createSaleInvoicesService } from "./sale-invoices";

const unknownId = "0192f3a0-0000-7000-8000-000000000099";
const pdfBytes = Buffer.from("%PDF-1.4 fake");

function okBill(result: BillResult) {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.bill;
}

function okSale(result: CompleteSaleResult) {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.sale;
}

describe("createSaleInvoicesService", () => {
  let kit: CheckoutKit;
  let toPdf: ReturnType<typeof vi.fn<(model: DocumentModel) => Promise<Buffer>>>;
  let print: ReturnType<typeof vi.fn<(model: DocumentModel) => Promise<DocumentPrintOutcome>>>;
  let chooseSavePath: ReturnType<typeof vi.fn<(name: string) => Promise<string | null>>>;
  let outPath: string;
  let service: ReturnType<typeof createSaleInvoicesService>;

  beforeEach(() => {
    kit = createCheckoutKit();
    kit.signIn("cashier");
    kit.openShift(500000);
    outPath = join(kit.dir, "invoice.pdf");
    toPdf = vi.fn(async () => pdfBytes);
    print = vi.fn(async () => "printed" as const);
    chooseSavePath = vi.fn(async () => outPath);
    service = createSaleInvoicesService({
      database: kit.database,
      sessions: kit.sessions,
      renderer: { toPdf, print },
      chooseSavePath,
    });
  });

  afterEach(() => kit.close());

  async function modelOf(saleId: string): Promise<DocumentModel> {
    await service.print({ saleId });
    return print.mock.calls.at(-1)![0];
  }

  const exempt = () => kit.taxCategoryId("Exempt");

  function sellSimple() {
    const tea = kit.addProduct({ nameEn: "Tea", searchText: "tea", salePricePaisa: 10000 });
    const draft = okBill(kit.billDrafts.addProduct({ productId: tea.id, qtyMilli: 1000 }));
    return okSale(
      kit.sales.complete({ draftId: draft.id, payments: [{ method: "cash", amountPaisa: 20000 }] }),
    );
  }

  function sellMixed() {
    kit.database.db.update(stores).set({ cashRoundingEnabled: true }).run();
    const tea = kit.addProduct({
      nameEn: "Tea",
      nameUr: "چائے",
      searchText: "tea",
      salePricePaisa: 10049,
    });
    const soap = kit.addProduct({
      nameEn: "Soap",
      searchText: "soap",
      salePricePaisa: 5025,
      taxCategoryId: exempt(),
    });
    okBill(kit.billDrafts.addProduct({ productId: tea.id, qtyMilli: 2000 }));
    const bill = okBill(kit.billDrafts.addProduct({ productId: soap.id, qtyMilli: 1000 }));
    const teaLine = bill.lines.find((line) => line.name === "Tea")!;
    okBill(
      kit.billDrafts.updateLine({
        lineId: teaLine.id,
        discount: { kind: "percent", bps: 1000 },
      }),
    );
    okBill(
      kit.billDrafts.setBillDiscount({
        draftId: bill.id,
        discount: { kind: "amount", amountPaisa: 333 },
      }),
    );
    return okSale(
      kit.sales.complete({
        draftId: bill.id,
        payments: [
          { method: "card", amountPaisa: 5000, reference: "4321" },
          { method: "cash", amountPaisa: 20000 },
        ],
        buyer: {
          name: "Bilal Traders",
          ntn: "1234567-8",
          cnic: "35202-1234567-1",
          phone: "03001234567",
        },
      }),
    );
  }

  const tempFiles = () => readdirSync(kit.dir).filter((name) => name.endsWith(".tmp"));

  describe("savePdf", () => {
    it("writes the rendered bytes to the chosen path and names the file by title and number", async () => {
      const sale = sellSimple();

      const result = await service.savePdf({ saleId: sale.id });

      expect(result).toEqual({ ok: true, status: "saved", path: outPath });
      expect(readFileSync(outPath)).toEqual(pdfBytes);
      expect(chooseSavePath).toHaveBeenCalledWith("Invoice T1-000001.pdf");
      expect(tempFiles()).toEqual([]);
    });

    it("writes nothing when the dialog is cancelled", async () => {
      const sale = sellSimple();
      chooseSavePath.mockResolvedValueOnce(null);

      expect(await service.savePdf({ saleId: sale.id })).toEqual({
        ok: true,
        status: "cancelled",
      });
      expect(toPdf).not.toHaveBeenCalled();
      expect(existsSync(outPath)).toBe(false);
    });

    it("reports not-found for an unknown sale without opening the dialog", async () => {
      expect(await service.savePdf({ saleId: unknownId })).toEqual({
        ok: false,
        reason: "not-found",
        message: invoiceMessages.notFound,
      });
      expect(chooseSavePath).not.toHaveBeenCalled();
    });

    it("reports not-found for another terminal's sale", async () => {
      const sale = sellSimple();
      const otherTerminal = kit.database.db
        .insert(terminals)
        .values({ storeId: kit.storeId, code: "T2" })
        .returning()
        .get();
      kit.database.db
        .update(sales)
        .set({ terminalId: otherTerminal.id })
        .where(eq(sales.id, sale.id))
        .run();

      expect(await service.savePdf({ saleId: sale.id })).toMatchObject({
        ok: false,
        reason: "not-found",
      });
    });

    it("returns failed and leaves no partial file when the render fails", async () => {
      const sale = sellSimple();
      toPdf.mockRejectedValueOnce(new Error("render"));

      expect(await service.savePdf({ saleId: sale.id })).toEqual({
        ok: false,
        reason: "failed",
        message: invoiceMessages.pdfFailed,
      });
      expect(existsSync(outPath)).toBe(false);
      expect(tempFiles()).toEqual([]);
    });

    it("returns failed and leaves no partial file when the write fails", async () => {
      const sale = sellSimple();
      chooseSavePath.mockResolvedValueOnce(join(kit.dir, "missing-folder", "invoice.pdf"));

      expect(await service.savePdf({ saleId: sale.id })).toMatchObject({
        ok: false,
        reason: "failed",
      });
      expect(tempFiles()).toEqual([]);
    });

    it("requires a session", async () => {
      const sale = sellSimple();
      kit.sessions.end();

      await expect(service.savePdf({ saleId: sale.id })).rejects.toThrow(UnauthenticatedError);
    });

    it("requires a session again after the dialog closes", async () => {
      const sale = sellSimple();
      chooseSavePath.mockImplementationOnce(async () => {
        kit.sessions.end();
        return outPath;
      });

      await expect(service.savePdf({ saleId: sale.id })).rejects.toThrow(UnauthenticatedError);
      expect(toPdf).not.toHaveBeenCalled();
    });
  });

  describe("print", () => {
    it.each(["printed", "cancelled"] as const)("returns %s", async (outcome) => {
      const sale = sellSimple();
      print.mockResolvedValueOnce(outcome);

      expect(await service.print({ saleId: sale.id })).toEqual({ ok: true, status: outcome });
    });

    it("maps a failed outcome and a thrown error to failed", async () => {
      const sale = sellSimple();
      print.mockResolvedValueOnce("failed");
      print.mockRejectedValueOnce(new Error("boom"));
      const failed = { ok: false, reason: "failed", message: invoiceMessages.printFailed };

      expect(await service.print({ saleId: sale.id })).toEqual(failed);
      expect(await service.print({ saleId: sale.id })).toEqual(failed);
    });

    it("reports not-found for an unknown sale", async () => {
      expect(await service.print({ saleId: unknownId })).toMatchObject({
        ok: false,
        reason: "not-found",
      });
      expect(print).not.toHaveBeenCalled();
    });

    it("requires a session", async () => {
      const sale = sellSimple();
      kit.sessions.end();

      await expect(service.print({ saleId: sale.id })).rejects.toThrow(UnauthenticatedError);
    });
  });

  describe("document content", () => {
    it("matches the sales row to the paisa, with line amounts and rounding adding up", async () => {
      const sale = sellMixed();
      const row = kit.database.db.select().from(sales).where(eq(sales.id, sale.id)).get()!;

      const model = await modelOf(sale.id);

      const money = (label: string) => model.totals.find((total) => total.label === label)?.value;
      expect(model.title).toBe("Invoice");
      expect(row.roundingPaisa).not.toBe(0);
      expect(money("Total")).toBe(formatRupees(row.totalPaisa));
      const amounts = model.rows.map((cells) => cells[7]!.text);
      const lineSum = kit.database.db
        .select()
        .from(saleLines)
        .all()
        .reduce((sum, line) => sum + line.totalPaisa, 0);
      expect(lineSum + row.roundingPaisa).toBe(row.totalPaisa);
      expect(amounts).toHaveLength(2);
      expect(model.panels.at(-1)).toEqual({
        label: "Buyer",
        lines: ["Bilal Traders", "NTN: 1234567-8", "CNIC: 35202-1234567-1", "Phone: 03001234567"],
      });
      expect(model.summaries[0]!.rows).toHaveLength(2);
      expect(model.summaries[1]!.rows.map((cells) => cells[1]!.text)).toEqual(["4321", "", ""]);
    });

    it("does not change when the catalog changes after the sale", async () => {
      const sale = sellMixed();
      const before = await modelOf(sale.id);

      kit.database.db
        .update(products)
        .set({
          nameEn: "Renamed",
          salePricePaisa: 99999,
          costPaisa: 1,
          taxCategoryId: exempt(),
        })
        .run();

      expect(await modelOf(sale.id)).toEqual(before);
    });

    it("titles a refund through returns Credit note and names the original invoice", async () => {
      const soap = kit.addProduct({
        nameEn: "Soap",
        searchText: "soap",
        salePricePaisa: 15000,
        taxCategoryId: exempt(),
      });
      const draft = okBill(kit.billDrafts.addProduct({ productId: soap.id, qtyMilli: 3000 }));
      const original = okSale(
        kit.sales.complete({
          draftId: draft.id,
          payments: [{ method: "cash", amountPaisa: 45000 }],
        }),
      );
      const detail = kit.database.db.select().from(saleLines).get()!;
      const refundBill = okBill(
        kit.returns.addFromSale({
          saleId: original.id,
          lines: [{ saleLineId: detail.id, qtyMilli: 1000 }],
        }),
      );
      const refund = okSale(
        kit.sales.complete({
          draftId: refundBill.id,
          payments: [{ method: "cash", amountPaisa: 15000 }],
        }),
      );

      const model = await modelOf(refund.id);

      expect(model.title).toBe("Credit note");
      expect(model.facts).toContainEqual({ label: "Original invoice", value: original.invoiceNo });
      expect(model.rows[0]![2]!.text).toBe("−1");
      expect(model.rows[0]![7]!.text).toBe("−Rs 150");
      await service.savePdf({ saleId: refund.id });
      expect(chooseSavePath).toHaveBeenLastCalledWith(`Credit note ${refund.invoiceNo}.pdf`);
    });
  });
});
