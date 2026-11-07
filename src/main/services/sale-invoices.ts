import type { z } from "zod";
import {
  invoiceMessages,
  type PrintInvoiceResult,
  type SaveInvoicePdfResult,
} from "../../shared/invoices";
import type { saleIdInputSchema } from "../../shared/receipt";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import type { DocumentRenderer } from "../documents/document-window";
import { buildSaleInvoiceDocument } from "../documents/sale-invoice-document";
import { writeAtomic } from "../documents/write-atomic";
import { loadSaleSnapshot } from "../receipts/sale-snapshot";

type SaleInput = z.output<typeof saleIdInputSchema>;

interface SaleInvoicesDeps {
  database: VendoraDatabase;
  sessions: SessionStore;
  renderer: DocumentRenderer;
  chooseSavePath: (defaultFileName: string) => Promise<string | null>;
}

const notFound = { ok: false, reason: "not-found", message: invoiceMessages.notFound } as const;
const pdfFailed = { ok: false, reason: "failed", message: invoiceMessages.pdfFailed } as const;
const printFailed = { ok: false, reason: "failed", message: invoiceMessages.printFailed } as const;

export function createSaleInvoicesService({
  database,
  sessions,
  renderer,
  chooseSavePath,
}: SaleInvoicesDeps) {
  function load({ saleId }: SaleInput) {
    const snapshot = loadSaleSnapshot(database.db, saleId);
    return snapshot ? buildSaleInvoiceDocument(snapshot) : null;
  }

  return {
    async savePdf(input: SaleInput): Promise<SaveInvoicePdfResult> {
      requireSession(sessions);
      const model = load(input);
      if (!model) return notFound;
      const path = await chooseSavePath(`${model.title} ${model.reference}.pdf`);
      if (path === null) return { ok: true, status: "cancelled" };
      requireSession(sessions);
      try {
        await writeAtomic(path, await renderer.toPdf(model));
      } catch {
        return pdfFailed;
      }
      return { ok: true, status: "saved", path };
    },

    async print(input: SaleInput): Promise<PrintInvoiceResult> {
      requireSession(sessions);
      const model = load(input);
      if (!model) return notFound;
      const outcome = await renderer.print(model).catch(() => "failed" as const);
      if (outcome === "failed") return printFailed;
      return { ok: true, status: outcome };
    },
  };
}

export type SaleInvoicesService = ReturnType<typeof createSaleInvoicesService>;
