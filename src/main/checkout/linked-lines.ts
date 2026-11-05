import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { PaymentMethod } from "../../shared/checkout";
import { products, saleLines, salePayments, sales } from "../db/schema";
import type { DbExecutor } from "../db/terminal";
import { refundLineAmounts, type LineParts, type RefundLineAmounts } from "./refund-amounts";

export type LinkedOriginal = {
  line: typeof saleLines.$inferSelect;
  saleId: string;
  invoiceNo: string;
  pricesIncludeTax: boolean;
  isSystemProduct: boolean;
  original: LineParts;
  refunded: LineParts;
};

const partsOf = (line: typeof saleLines.$inferSelect): LineParts => ({
  qtyMilli: line.qtyMilli,
  grossPaisa: line.grossPaisa,
  lineDiscountPaisa: line.lineDiscountPaisa,
  billDiscountPaisa: line.billDiscountPaisa,
  taxPaisa: line.taxPaisa,
});

export function loadLinkedOriginals(
  tx: DbExecutor,
  lineIds: readonly string[],
): Map<string, LinkedOriginal> {
  const found = new Map<string, LinkedOriginal>();
  if (lineIds.length === 0) return found;

  const originals = tx
    .select({
      line: saleLines,
      invoiceNo: sales.invoiceNo,
      pricesIncludeTax: sales.pricesIncludeTax,
      isSystemProduct: products.isSystem,
    })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .innerJoin(products, eq(products.id, saleLines.productId))
    .where(inArray(saleLines.id, [...lineIds]))
    .all();

  const refundedRows = tx
    .select({
      lineId: saleLines.refundedLineId,
      qtyMilli: sql<number>`coalesce(sum(-${saleLines.qtyMilli}), 0)`,
      grossPaisa: sql<number>`coalesce(sum(-${saleLines.grossPaisa}), 0)`,
      lineDiscountPaisa: sql<number>`coalesce(sum(-${saleLines.lineDiscountPaisa}), 0)`,
      billDiscountPaisa: sql<number>`coalesce(sum(-${saleLines.billDiscountPaisa}), 0)`,
      taxPaisa: sql<number>`coalesce(sum(-${saleLines.taxPaisa}), 0)`,
    })
    .from(saleLines)
    .where(inArray(saleLines.refundedLineId, [...lineIds]))
    .groupBy(saleLines.refundedLineId)
    .all();
  const refundedOf = new Map(refundedRows.map((row) => [row.lineId, row]));

  for (const row of originals) {
    const refunded = refundedOf.get(row.line.id);
    found.set(row.line.id, {
      line: row.line,
      saleId: row.line.saleId,
      invoiceNo: row.invoiceNo,
      pricesIncludeTax: row.pricesIncludeTax,
      isSystemProduct: row.isSystemProduct,
      original: partsOf(row.line),
      refunded: refunded
        ? {
            qtyMilli: refunded.qtyMilli,
            grossPaisa: refunded.grossPaisa,
            lineDiscountPaisa: refunded.lineDiscountPaisa,
            billDiscountPaisa: refunded.billDiscountPaisa,
            taxPaisa: refunded.taxPaisa,
          }
        : { qtyMilli: 0, grossPaisa: 0, lineDiscountPaisa: 0, billDiscountPaisa: 0, taxPaisa: 0 },
    });
  }
  return found;
}

export const leftQtyMilli = (linked: LinkedOriginal): number =>
  linked.original.qtyMilli - linked.refunded.qtyMilli;

const ZERO_AMOUNTS: RefundLineAmounts = {
  grossPaisa: 0,
  lineDiscountPaisa: 0,
  billDiscountPaisa: 0,
  taxPaisa: 0,
  totalPaisa: 0,
};

export function linkedAmounts(linked: LinkedOriginal, qtyMilli: number): RefundLineAmounts {
  const left = leftQtyMilli(linked);
  const capped = Math.min(qtyMilli, left);
  if (capped <= 0) return ZERO_AMOUNTS;
  return refundLineAmounts({
    original: linked.original,
    pricesIncludeTax: linked.pricesIncludeTax,
    refunded: linked.refunded,
    qtyMilli: capped,
  });
}

export type RefundMethodAvailability = { method: PaymentMethod; availablePaisa: number };

export function loadRefundMethods(tx: DbExecutor, saleId: string): RefundMethodAvailability[] {
  const took = tx
    .select({
      method: salePayments.method,
      paisa: sql<number>`coalesce(sum(${salePayments.amountPaisa}), 0)`,
    })
    .from(salePayments)
    .where(and(eq(salePayments.saleId, saleId), eq(salePayments.isChange, false)))
    .groupBy(salePayments.method)
    .orderBy(asc(sql`min(${salePayments.position})`))
    .all();

  const refunded = tx
    .select({
      method: salePayments.method,
      paisa: sql<number>`coalesce(sum(-${salePayments.amountPaisa}), 0)`,
    })
    .from(salePayments)
    .innerJoin(sales, eq(sales.id, salePayments.saleId))
    .where(and(eq(sales.refundedSaleId, saleId), eq(salePayments.isChange, false)))
    .groupBy(salePayments.method)
    .all();
  const refundedOf = new Map(refunded.map((row) => [row.method, row.paisa]));

  return took
    .filter((row) => row.method !== "cash")
    .map((row) => ({
      method: row.method,
      availablePaisa: Math.max(0, row.paisa - (refundedOf.get(row.method) ?? 0)),
    }));
}
