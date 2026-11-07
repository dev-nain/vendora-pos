import { and, eq, sql, type SQL } from "drizzle-orm";
import { unionAll } from "drizzle-orm/sqlite-core";
import { productMessages } from "../../shared/products";
import type {
  ProductPurchaseHistoryQuery,
  ProductPurchaseHistoryResult,
  PurchaseHistoryRow,
  SupplierPurchaseHistoryQuery,
  SupplierPurchaseHistoryResult,
} from "../../shared/purchase-history";
import { supplierMessages } from "../../shared/suppliers";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import {
  goodsReceivedLines,
  goodsReceivedNotes,
  products,
  purchaseReturnLines,
  purchaseReturns,
  suppliers,
} from "../db/schema";
import { lastReceipt } from "./goods-received";

interface PurchaseHistoryDeps {
  database: VendoraDatabase;
  sessions: SessionStore;
}

const notFound = (message: string) => ({ ok: false, reason: "not-found", message }) as const;

export function createPurchaseHistoryService({ database, sessions }: PurchaseHistoryDeps) {
  const { db } = database;

  function page(
    storeId: string,
    scope: { productId: string } | { supplierId: string },
    limit: number,
    offset: number,
  ): { items: PurchaseHistoryRow[]; hasMore: boolean } {
    const receiptScope: SQL[] =
      "productId" in scope
        ? [eq(goodsReceivedLines.productId, scope.productId)]
        : [eq(goodsReceivedNotes.supplierId, scope.supplierId)];
    const returnScope: SQL[] =
      "productId" in scope
        ? [eq(purchaseReturnLines.productId, scope.productId)]
        : [eq(purchaseReturns.supplierId, scope.supplierId)];

    const receipts = db
      .select({
        id: sql<string>`${goodsReceivedLines.id}`.as("id"),
        kind: sql<"receipt" | "return">`'receipt'`.as("kind"),
        documentId: sql<string>`${goodsReceivedNotes.id}`.as("document_id"),
        documentNo: sql<string>`${goodsReceivedNotes.grnNo}`.as("document_no"),
        createdAt: sql<number>`${goodsReceivedLines.createdAt}`.as("created_at"),
        productId: sql<string>`${goodsReceivedLines.productId}`.as("product_id"),
        nameEn: sql<string>`${goodsReceivedLines.nameEn}`.as("name_en"),
        nameUr: sql<string | null>`${goodsReceivedLines.nameUr}`.as("name_ur"),
        unit: sql<PurchaseHistoryRow["unit"]>`${goodsReceivedLines.unit}`.as("unit"),
        supplierId: sql<string>`${goodsReceivedNotes.supplierId}`.as("supplier_id"),
        supplierName: sql<string>`${suppliers.name}`.as("supplier_name"),
        qtyMilli: sql<number>`${goodsReceivedLines.qtyMilli}`.as("qty_milli"),
        unitCostPaisa: sql<number>`${goodsReceivedLines.unitCostPaisa}`.as("unit_cost_paisa"),
        lineTotalPaisa: sql<number>`${goodsReceivedLines.lineTotalPaisa}`.as("line_total_paisa"),
      })
      .from(goodsReceivedLines)
      .innerJoin(
        goodsReceivedNotes,
        eq(goodsReceivedNotes.id, goodsReceivedLines.goodsReceivedNoteId),
      )
      .innerJoin(suppliers, eq(suppliers.id, goodsReceivedNotes.supplierId))
      .where(and(eq(goodsReceivedNotes.storeId, storeId), ...receiptScope));

    const returns = db
      .select({
        id: sql<string>`${purchaseReturnLines.id}`.as("id"),
        kind: sql<"receipt" | "return">`'return'`.as("kind"),
        documentId: sql<string>`${purchaseReturns.id}`.as("document_id"),
        documentNo: sql<string>`${purchaseReturns.returnNo}`.as("document_no"),
        createdAt: sql<number>`${purchaseReturnLines.createdAt}`.as("created_at"),
        productId: sql<string>`${purchaseReturnLines.productId}`.as("product_id"),
        nameEn: sql<string>`${purchaseReturnLines.nameEn}`.as("name_en"),
        nameUr: sql<string | null>`${purchaseReturnLines.nameUr}`.as("name_ur"),
        unit: sql<PurchaseHistoryRow["unit"]>`${purchaseReturnLines.unit}`.as("unit"),
        supplierId: sql<string>`${purchaseReturns.supplierId}`.as("supplier_id"),
        supplierName: sql<string>`${suppliers.name}`.as("supplier_name"),
        qtyMilli: sql<number>`-${purchaseReturnLines.qtyMilli}`.as("qty_milli"),
        unitCostPaisa: sql<number>`${purchaseReturnLines.unitCostPaisa}`.as("unit_cost_paisa"),
        lineTotalPaisa: sql<number>`-${purchaseReturnLines.lineTotalPaisa}`.as("line_total_paisa"),
      })
      .from(purchaseReturnLines)
      .innerJoin(purchaseReturns, eq(purchaseReturns.id, purchaseReturnLines.purchaseReturnId))
      .innerJoin(suppliers, eq(suppliers.id, purchaseReturns.supplierId))
      .where(and(eq(purchaseReturns.storeId, storeId), ...returnScope));

    const rows = unionAll(receipts, returns)
      .orderBy(sql`created_at desc`, sql`id desc`)
      .limit(limit + 1)
      .offset(offset)
      .all();

    return {
      items: rows.slice(0, limit).map((row) => ({
        ...row,
        createdAt: new Date(row.createdAt).toISOString(),
      })),
      hasMore: rows.length > limit,
    };
  }

  function forProduct(query: ProductPurchaseHistoryQuery): ProductPurchaseHistoryResult {
    const session = requireSession(sessions);
    const product = db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, query.productId), eq(products.storeId, session.storeId)))
      .get();
    if (!product) return notFound(productMessages.notFound);

    const last = lastReceipt(db, session.storeId, product.id);
    return {
      ok: true,
      lastReceipt: last ? { ...last, receivedAt: last.receivedAt.toISOString() } : null,
      ...page(session.storeId, { productId: product.id }, query.limit, query.offset),
    };
  }

  function forSupplier(query: SupplierPurchaseHistoryQuery): SupplierPurchaseHistoryResult {
    const session = requireSession(sessions);
    const supplier = db
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(and(eq(suppliers.id, query.supplierId), eq(suppliers.storeId, session.storeId)))
      .get();
    if (!supplier) return notFound(supplierMessages.notFound);

    return {
      ok: true,
      supplier,
      ...page(session.storeId, { supplierId: supplier.id }, query.limit, query.offset),
    };
  }

  return { forProduct, forSupplier };
}
export type PurchaseHistoryService = ReturnType<typeof createPurchaseHistoryService>;
