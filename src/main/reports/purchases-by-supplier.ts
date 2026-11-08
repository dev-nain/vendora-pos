import { and, eq, gte, lt, sql } from "drizzle-orm";
import { storeDayBounds, type ReportRange } from "../../shared/reports";
import type { PurchasesBySupplierResult, PurchasesBySupplierRow } from "../../shared/stock-reports";
import type { VendoraDatabase } from "../db/client";
import { goodsReceivedNotes, purchaseReturns, suppliers } from "../db/schema";

type Tally = { count: number; paisa: number };

export function readPurchasesBySupplier(
  database: VendoraDatabase,
  storeId: string,
  range: ReportRange,
): PurchasesBySupplierResult {
  const { db } = database;
  const { start, end } = storeDayBounds(range);

  const received = new Map<string, Tally>(
    db
      .select({
        supplierId: goodsReceivedNotes.supplierId,
        count: sql<number>`count(*)`,
        paisa: sql<number>`coalesce(sum(${goodsReceivedNotes.totalPaisa}), 0)`,
      })
      .from(goodsReceivedNotes)
      .where(
        and(
          eq(goodsReceivedNotes.storeId, storeId),
          gte(goodsReceivedNotes.createdAt, start),
          lt(goodsReceivedNotes.createdAt, end),
        ),
      )
      .groupBy(goodsReceivedNotes.supplierId)
      .all()
      .map((row) => [row.supplierId, { count: row.count, paisa: row.paisa }]),
  );
  const returned = new Map<string, Tally>(
    db
      .select({
        supplierId: purchaseReturns.supplierId,
        count: sql<number>`count(*)`,
        paisa: sql<number>`coalesce(sum(${purchaseReturns.totalPaisa}), 0)`,
      })
      .from(purchaseReturns)
      .where(
        and(
          eq(purchaseReturns.storeId, storeId),
          gte(purchaseReturns.createdAt, start),
          lt(purchaseReturns.createdAt, end),
        ),
      )
      .groupBy(purchaseReturns.supplierId)
      .all()
      .map((row) => [row.supplierId, { count: row.count, paisa: row.paisa }]),
  );

  const supplierIds = new Set([...received.keys(), ...returned.keys()]);
  const names = db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.storeId, storeId))
    .orderBy(sql`lower(${suppliers.name})`, suppliers.id)
    .all()
    .filter((supplier) => supplierIds.has(supplier.id));

  const none: Tally = { count: 0, paisa: 0 };
  const rows: PurchasesBySupplierRow[] = names.map(({ id, name }) => {
    const got = received.get(id) ?? none;
    const sent = returned.get(id) ?? none;
    return {
      supplierId: id,
      supplier: name,
      receiptCount: got.count,
      receivedPaisa: got.paisa,
      returnCount: sent.count,
      returnedPaisa: sent.paisa,
      netPaisa: got.paisa - sent.paisa,
    };
  });

  return {
    rows,
    totals: {
      receiptCount: rows.reduce((sum, row) => sum + row.receiptCount, 0),
      receivedPaisa: rows.reduce((sum, row) => sum + row.receivedPaisa, 0),
      returnCount: rows.reduce((sum, row) => sum + row.returnCount, 0),
      returnedPaisa: rows.reduce((sum, row) => sum + row.returnedPaisa, 0),
      netPaisa: rows.reduce((sum, row) => sum + row.netPaisa, 0),
    },
  };
}
