import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { movementReasonLabels, movementTypeLabels } from "../../shared/inventory";
import { storeDayBounds, type ReportRange } from "../../shared/reports";
import type {
  StockMovementReportRow,
  StockMovementsReportResult,
} from "../../shared/stock-reports";
import type { VendoraDatabase } from "../db/client";
import {
  goodsReceivedLines,
  goodsReceivedNotes,
  products,
  purchaseReturnLines,
  purchaseReturns,
  saleLines,
  sales,
  stockMovements,
  users,
} from "../db/schema";
import { stockValuePaisa } from "../services/stock-value";

const LOOKUP_CHUNK = 500;

const empty = (): StockMovementsReportResult => ({
  product: null,
  openingMilli: 0,
  closingMilli: 0,
  rows: [],
  totals: { valuePaisa: 0 },
});

function lookup(
  ids: string[],
  query: (chunk: string[]) => { id: string; reference: string }[],
): Map<string, string> {
  const found = new Map<string, string>();
  for (let index = 0; index < ids.length; index += LOOKUP_CHUNK) {
    for (const row of query(ids.slice(index, index + LOOKUP_CHUNK))) {
      found.set(row.id, row.reference);
    }
  }
  return found;
}

export function readStockMovements(
  database: VendoraDatabase,
  storeId: string,
  input: { productId: string; range: ReportRange },
): StockMovementsReportResult {
  const { db } = database;
  const product = db
    .select({ id: products.id, nameEn: products.nameEn, unit: products.unit })
    .from(products)
    .where(
      and(
        eq(products.id, input.productId),
        eq(products.storeId, storeId),
        isNull(products.deletedAt),
        eq(products.isSystem, false),
      ),
    )
    .get();
  if (!product) return empty();

  const { start, end } = storeDayBounds(input.range);
  const forProduct = and(
    eq(stockMovements.storeId, storeId),
    eq(stockMovements.productId, product.id),
  );

  const opening =
    db
      .select({ total: sql<number>`coalesce(sum(${stockMovements.qtyMilli}), 0)` })
      .from(stockMovements)
      .where(and(forProduct, lt(stockMovements.createdAt, start)))
      .get()?.total ?? 0;

  const movements = db
    .select({
      id: stockMovements.id,
      createdAt: stockMovements.createdAt,
      type: stockMovements.type,
      qtyMilli: stockMovements.qtyMilli,
      unitCostPaisa: stockMovements.unitCostPaisa,
      reason: stockMovements.reason,
      sourceType: stockMovements.sourceType,
      sourceId: stockMovements.sourceId,
      userName: users.displayName,
    })
    .from(stockMovements)
    .leftJoin(users, eq(users.id, stockMovements.actorUserId))
    .where(and(forProduct, gte(stockMovements.createdAt, start), lt(stockMovements.createdAt, end)))
    .orderBy(asc(stockMovements.createdAt), asc(stockMovements.id))
    .all();

  const sourceIds = (type: string) => [
    ...new Set(
      movements.flatMap((movement) =>
        movement.sourceType === type && movement.sourceId ? [movement.sourceId] : [],
      ),
    ),
  ];

  const invoices = lookup(sourceIds("sale_line"), (chunk) =>
    db
      .select({ id: saleLines.id, reference: sales.invoiceNo })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .where(inArray(saleLines.id, chunk))
      .all()
      .map((row) => ({ id: row.id, reference: `Invoice ${row.reference}` })),
  );
  const receipts = lookup(sourceIds("goods_received_line"), (chunk) =>
    db
      .select({ id: goodsReceivedLines.id, reference: goodsReceivedNotes.grnNo })
      .from(goodsReceivedLines)
      .innerJoin(
        goodsReceivedNotes,
        eq(goodsReceivedNotes.id, goodsReceivedLines.goodsReceivedNoteId),
      )
      .where(inArray(goodsReceivedLines.id, chunk))
      .all()
      .map((row) => ({ id: row.id, reference: `GRN ${row.reference}` })),
  );
  const returns = lookup(sourceIds("purchase_return_line"), (chunk) =>
    db
      .select({ id: purchaseReturnLines.id, reference: purchaseReturns.returnNo })
      .from(purchaseReturnLines)
      .innerJoin(purchaseReturns, eq(purchaseReturns.id, purchaseReturnLines.purchaseReturnId))
      .where(inArray(purchaseReturnLines.id, chunk))
      .all()
      .map((row) => ({ id: row.id, reference: `Return ${row.reference}` })),
  );

  const referenceOf = (movement: (typeof movements)[number]): string => {
    if (movement.reason) return movementReasonLabels[movement.reason];
    if (!movement.sourceId) return "";
    const byType: Record<string, Map<string, string>> = {
      sale_line: invoices,
      goods_received_line: receipts,
      purchase_return_line: returns,
    };
    return byType[movement.sourceType ?? ""]?.get(movement.sourceId) ?? "";
  };

  let balance = opening;
  let valuePaisa = 0;
  const rows: StockMovementReportRow[] = movements.map((movement) => {
    balance += movement.qtyMilli;
    const value = stockValuePaisa(movement.qtyMilli, movement.unitCostPaisa);
    valuePaisa += value;
    return {
      id: movement.id,
      createdAt: movement.createdAt.toISOString(),
      type: movementTypeLabels[movement.type],
      reference: referenceOf(movement),
      unit: product.unit,
      qtyMilli: movement.qtyMilli,
      balanceMilli: balance,
      valuePaisa: value,
      userName: movement.userName ?? "",
    };
  });

  return {
    product,
    openingMilli: opening,
    closingMilli: balance,
    rows,
    totals: { valuePaisa },
  };
}
