import { eq } from "drizzle-orm";
import type { z } from "zod";
import {
  purchaseReturnMessages,
  type PrintPurchaseReturnResult,
  type SavePurchaseReturnPdfResult,
  type purchaseReturnIdInputSchema,
} from "../../shared/purchase-returns";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { suppliers } from "../db/schema";
import { writeAtomic } from "../documents/write-atomic";
import type { DocumentRenderer } from "../documents/document-window";
import type { PurchaseOrderSupplier } from "../documents/purchase-order-document";
import { buildPurchaseReturnDocument } from "../documents/purchase-return-document";
import { getReceiptSettings } from "../settings/store-settings";
import type { PurchaseReturnsService } from "./purchase-returns";

type IdInput = z.output<typeof purchaseReturnIdInputSchema>;

interface PurchaseReturnDocumentsDeps {
  database: VendoraDatabase;
  sessions: SessionStore;
  purchaseReturns: Pick<PurchaseReturnsService, "get">;
  renderer: DocumentRenderer;
  chooseSavePath: (defaultFileName: string) => Promise<string | null>;
}

const notFound = {
  ok: false,
  reason: "not-found",
  message: purchaseReturnMessages.notFound,
} as const;

const pdfFailed = {
  ok: false,
  reason: "failed",
  message: purchaseReturnMessages.pdfFailed,
} as const;

export function createPurchaseReturnDocumentsService({
  database,
  sessions,
  purchaseReturns,
  renderer,
  chooseSavePath,
}: PurchaseReturnDocumentsDeps) {
  function load(input: IdInput) {
    const result = purchaseReturns.get(input);
    if (!result.ok) return null;
    const { purchaseReturn } = result;
    const session = requireSession(sessions);
    const row = database.db
      .select({
        contactPerson: suppliers.contactPerson,
        phone: suppliers.phone,
        ntn: suppliers.ntn,
      })
      .from(suppliers)
      .where(eq(suppliers.id, purchaseReturn.supplierId))
      .get();
    const supplier: PurchaseOrderSupplier = row ?? {
      contactPerson: null,
      phone: null,
      ntn: null,
    };
    const store = getReceiptSettings(database.db, session.storeId);
    return {
      purchaseReturn,
      model: buildPurchaseReturnDocument({ purchaseReturn, store, supplier }),
    };
  }

  return {
    async savePdf(input: IdInput): Promise<SavePurchaseReturnPdfResult> {
      requireSession(sessions);
      const loaded = load(input);
      if (!loaded) return notFound;
      const path = await chooseSavePath(`${loaded.purchaseReturn.returnNo}.pdf`);
      if (path === null) return { ok: true, status: "cancelled" };
      requireSession(sessions);
      try {
        await writeAtomic(path, await renderer.toPdf(loaded.model));
      } catch {
        return pdfFailed;
      }
      return { ok: true, status: "saved", path };
    },

    async print(input: IdInput): Promise<PrintPurchaseReturnResult> {
      requireSession(sessions);
      const loaded = load(input);
      if (!loaded) return notFound;
      const outcome = await renderer.print(loaded.model).catch(() => "failed" as const);
      if (outcome === "failed") {
        return { ok: false, reason: "failed", message: purchaseReturnMessages.printFailed };
      }
      return { ok: true, status: outcome };
    },
  };
}

export type PurchaseReturnDocumentsService = ReturnType<
  typeof createPurchaseReturnDocumentsService
>;
