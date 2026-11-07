import { eq } from "drizzle-orm";
import type { z } from "zod";
import {
  purchaseOrderMessages,
  type PrintPurchaseOrderResult,
  type SavePurchaseOrderPdfResult,
  type purchaseOrderIdInputSchema,
} from "../../shared/purchase-orders";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { suppliers } from "../db/schema";
import type { DocumentRenderer } from "../documents/document-window";
import {
  buildPurchaseOrderDocument,
  type PurchaseOrderSupplier,
} from "../documents/purchase-order-document";
import { writeAtomic } from "../documents/write-atomic";
import { getReceiptSettings } from "../settings/store-settings";
import type { PurchaseOrdersService } from "./purchase-orders";

type IdInput = z.output<typeof purchaseOrderIdInputSchema>;

interface PurchaseOrderDocumentsDeps {
  database: VendoraDatabase;
  sessions: SessionStore;
  purchaseOrders: Pick<PurchaseOrdersService, "get">;
  renderer: DocumentRenderer;
  chooseSavePath: (defaultFileName: string) => Promise<string | null>;
}

const notFound = {
  ok: false,
  reason: "not-found",
  message: purchaseOrderMessages.notFound,
} as const;

const pdfFailed = {
  ok: false,
  reason: "failed",
  message: purchaseOrderMessages.pdfFailed,
} as const;

export function createPurchaseOrderDocumentsService({
  database,
  sessions,
  purchaseOrders,
  renderer,
  chooseSavePath,
}: PurchaseOrderDocumentsDeps) {
  function load(input: IdInput) {
    const result = purchaseOrders.get(input);
    if (!result.ok) return null;
    const { order } = result;
    const session = requireSession(sessions);
    const row = database.db
      .select({
        contactPerson: suppliers.contactPerson,
        phone: suppliers.phone,
        ntn: suppliers.ntn,
      })
      .from(suppliers)
      .where(eq(suppliers.id, order.supplierId))
      .get();
    const supplier: PurchaseOrderSupplier = row ?? {
      contactPerson: null,
      phone: null,
      ntn: null,
    };
    const store = getReceiptSettings(database.db, session.storeId);
    return { order, model: buildPurchaseOrderDocument({ order, store, supplier }) };
  }

  return {
    async savePdf(input: IdInput): Promise<SavePurchaseOrderPdfResult> {
      requireSession(sessions);
      const loaded = load(input);
      if (!loaded) return notFound;
      const path = await chooseSavePath(`${loaded.order.orderNo}.pdf`);
      if (path === null) return { ok: true, status: "cancelled" };
      requireSession(sessions);
      try {
        await writeAtomic(path, await renderer.toPdf(loaded.model));
      } catch {
        return pdfFailed;
      }
      return { ok: true, status: "saved", path };
    },

    async print(input: IdInput): Promise<PrintPurchaseOrderResult> {
      requireSession(sessions);
      const loaded = load(input);
      if (!loaded) return notFound;
      const outcome = await renderer.print(loaded.model).catch(() => "failed" as const);
      if (outcome === "failed") {
        return { ok: false, reason: "failed", message: purchaseOrderMessages.printFailed };
      }
      return { ok: true, status: outcome };
    },
  };
}

export type PurchaseOrderDocumentsService = ReturnType<typeof createPurchaseOrderDocumentsService>;
