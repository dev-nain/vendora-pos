import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { paymentMethodLabels, paymentMethods, type PaymentMethod } from "../../shared/checkout";
import type { ShiftSalesSummary } from "../../shared/shifts";
import { billDraftLines, billDrafts, saleLines, salePayments, sales } from "../db/schema";
import type { DbExecutor } from "../db/terminal";

const total = (value: number | null | undefined): number => value ?? 0;

export function shiftSalesSummary(executor: DbExecutor, shiftId: string): ShiftSalesSummary {
  const bills = executor
    .select({
      billCount: sql<number>`count(*)`,
      refundBillCount: sql<number>`coalesce(sum(case when ${sales.type} = 'refund' then 1 else 0 end), 0)`,
      totalPaisa: sql<number>`coalesce(sum(${sales.totalPaisa}), 0)`,
      discountCount: sql<number>`coalesce(sum(case when ${sales.discountPaisa} <> 0 then 1 else 0 end), 0)`,
      discountPaisa: sql<number>`coalesce(sum(${sales.discountPaisa}), 0)`,
    })
    .from(sales)
    .where(eq(sales.shiftId, shiftId))
    .get();

  const paymentRows = executor
    .select({
      method: salePayments.method,
      amountPaisa: sql<number>`sum(${salePayments.amountPaisa})`,
    })
    .from(salePayments)
    .innerJoin(sales, eq(sales.id, salePayments.saleId))
    .where(eq(sales.shiftId, shiftId))
    .groupBy(salePayments.method)
    .all();
  const paidByMethod = new Map(paymentRows.map((row) => [row.method, row.amountPaisa]));
  const byMethod = paymentMethods.map((method) => ({
    method,
    label: paymentMethodLabels[method],
    amountPaisa: paidByMethod.get(method) ?? 0,
  }));

  const taxes = executor
    .select({
      rateBps: saleLines.taxRateBps,
      taxablePaisa: sql<number>`sum(${saleLines.totalPaisa} - ${saleLines.taxPaisa})`,
      taxPaisa: sql<number>`sum(${saleLines.taxPaisa})`,
    })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .where(eq(sales.shiftId, shiftId))
    .groupBy(saleLines.taxRateBps)
    .orderBy(desc(saleLines.taxRateBps))
    .all();

  const returned = executor
    .select({
      count: sql<number>`count(*)`,
      totalPaisa: sql<number>`coalesce(sum(${saleLines.totalPaisa}), 0)`,
    })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .where(and(eq(sales.shiftId, shiftId), eq(saleLines.isReturn, true)))
    .get();

  const deleted = executor
    .select({ count: sql<number>`count(*)` })
    .from(billDraftLines)
    .innerJoin(billDrafts, eq(billDrafts.id, billDraftLines.draftId))
    .where(and(eq(billDrafts.shiftId, shiftId), isNotNull(billDraftLines.deletedAt)))
    .get();

  const discarded = executor
    .select({ count: sql<number>`count(*)` })
    .from(billDrafts)
    .where(
      and(
        eq(billDrafts.shiftId, shiftId),
        eq(billDrafts.state, "cancelled"),
        sql`exists (select 1 from bill_draft_lines where bill_draft_lines.draft_id = bill_drafts.id and bill_draft_lines.deleted_at is null)`,
      ),
    )
    .get();

  return {
    sales: {
      billCount: total(bills?.billCount),
      refundBillCount: total(bills?.refundBillCount),
      totalPaisa: total(bills?.totalPaisa),
      byMethod,
    },
    taxes,
    discounts: { count: total(bills?.discountCount), amountPaisa: total(bills?.discountPaisa) },
    refunds: { count: total(returned?.count), amountPaisa: -total(returned?.totalPaisa) },
    deletedLines: { count: total(deleted?.count) },
    discardedBills: { count: total(discarded?.count) },
  };
}

export function paymentPaisa(summary: ShiftSalesSummary, method: PaymentMethod): number {
  return summary.sales.byMethod.find((row) => row.method === method)?.amountPaisa ?? 0;
}
