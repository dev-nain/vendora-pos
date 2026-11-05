import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  checkoutMessages,
  type CompleteSaleInput,
  type CompleteSaleResult,
  type PaymentMethod,
} from "../../shared/checkout";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import { computeBill } from "../checkout/totals";
import { divRoundHalfUp } from "../../shared/rounding";
import type { VendoraDatabase } from "../db/client";
import { takeInvoiceNumber } from "../db/invoice-numbers";
import {
  changeRow,
  paymentRow,
  resolveTaxRateBps,
  saleLineRow,
  saleRow,
  type Buyer,
} from "../db/sale-rows";
import {
  billDraftLines,
  billDrafts,
  products,
  salePayments,
  saleLines,
  sales,
  taxCategories,
} from "../db/schema";
import { isUniqueViolation } from "../db/sqlite-errors";
import { currentTerminal, type DbExecutor } from "../db/terminal";
import { getCheckoutSettings } from "../settings/store-settings";
import type { createAuditService } from "./audit";
import { toDiscount, totalsLineOf } from "./bill-drafts";
import { NoOpenShiftError, requireOpenShift } from "./shifts";
import type { StockService } from "./stock";

interface SalesDeps {
  database: VendoraDatabase;
  audit: ReturnType<typeof createAuditService>;
  sessions: SessionStore;
  stock: StockService;
  now?: () => Date;
}

type Refusal = Extract<CompleteSaleResult, { ok: false }>;

const refuse = <Reason extends Exclude<Refusal["reason"], "underpaid">>(
  reason: Reason,
  message: string,
) => ({ ok: false, reason, message }) as Extract<Refusal, { reason: Reason }>;

const noOpenShift = refuse("no-open-shift", checkoutMessages.noOpenShift);
const notFound = refuse("not-found", checkoutMessages.notFound);
const emptyBill = refuse("empty-bill", checkoutMessages.emptyBill);
const cashNotRounded = refuse("cash-not-rounded", checkoutMessages.cashNotRounded);
const refundCashOnly = refuse("refund-cash-only", checkoutMessages.refundCashOnly);
const refundAmount = refuse("refund-amount", checkoutMessages.refundAmount);

function buyerOf(input: CompleteSaleInput["buyer"]): Buyer {
  return {
    name: input?.name || null,
    ntn: input?.ntn || null,
    cnic: input?.cnic || null,
    phone: input?.phone || null,
  };
}

function replayOf(tx: DbExecutor, draftId: string): CompleteSaleResult | null {
  const sale = tx.select().from(sales).where(eq(sales.draftId, draftId)).get();
  if (!sale) return null;
  const changePaisa =
    tx
      .select({ n: sql<number>`coalesce(sum(-${salePayments.amountPaisa}), 0)` })
      .from(salePayments)
      .where(and(eq(salePayments.saleId, sale.id), eq(salePayments.isChange, true)))
      .get()?.n ?? 0;
  return {
    ok: true,
    sale: {
      id: sale.id,
      invoiceNo: sale.invoiceNo,
      type: sale.type,
      totalPaisa: sale.totalPaisa,
      roundingPaisa: sale.roundingPaisa,
      changePaisa,
      createdAt: sale.createdAt.toISOString(),
      replayed: true,
    },
  };
}

export function createSalesService({
  database,
  audit,
  sessions,
  stock,
  now = () => new Date(),
}: SalesDeps) {
  const { db } = database;

  function completeInTransaction(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    input: CompleteSaleInput,
    session: ReturnType<typeof requireSession>,
  ): CompleteSaleResult {
    const replay = replayOf(tx, input.draftId);
    if (replay) return replay;

    const terminal = currentTerminal(tx);
    let shiftId: string;
    try {
      shiftId = requireOpenShift(tx, terminal.id).id;
    } catch (error) {
      if (error instanceof NoOpenShiftError) return noOpenShift;
      throw error;
    }

    const draft = tx
      .select()
      .from(billDrafts)
      .where(
        and(
          eq(billDrafts.id, input.draftId),
          eq(billDrafts.storeId, terminal.storeId),
          eq(billDrafts.terminalId, terminal.id),
          eq(billDrafts.shiftId, shiftId),
          eq(billDrafts.state, "draft"),
        ),
      )
      .get();
    if (!draft) return notFound;

    const rows = tx
      .select({
        line: billDraftLines,
        product: products,
        categoryRateBps: taxCategories.rateBps,
      })
      .from(billDraftLines)
      .innerJoin(products, eq(products.id, billDraftLines.productId))
      .innerJoin(taxCategories, eq(taxCategories.id, products.taxCategoryId))
      .where(and(eq(billDraftLines.draftId, draft.id), isNull(billDraftLines.deletedAt)))
      .orderBy(asc(billDraftLines.position))
      .all();
    if (rows.length === 0) return emptyBill;

    const settings = getCheckoutSettings(tx, terminal.storeId);
    const rateOf = (rate: number | null) => resolveTaxRateBps(rate, settings.standardTaxRateBps);
    const tenders = input.payments.map((payment) => ({
      method: payment.method,
      amountPaisa: payment.amountPaisa,
    }));
    const computed = computeBill({
      lines: rows.map(({ line, categoryRateBps }) => totalsLineOf(line, rateOf(categoryRateBps))),
      billDiscount: toDiscount(draft.billDiscountKind, draft.billDiscountValue),
      pricesIncludeTax: settings.pricesIncludeTax,
      rounding: settings.rounding,
      tenders,
    });
    const totalPaisa = computed.totals.totalPaisa;

    const unit = settings.rounding.unitPaisa;
    if (
      settings.rounding.mode !== "off" &&
      totalPaisa >= 0 &&
      tenders.some((tender) => tender.method === "cash" && tender.amountPaisa % unit !== 0)
    ) {
      return cashNotRounded;
    }

    const paidPaisa = tenders.reduce((acc, tender) => acc + tender.amountPaisa, 0);
    let changePaisa = 0;
    let paymentInputs: { method: PaymentMethod; amountPaisa: number; reference: string | null }[] =
      input.payments.map((payment) => ({
        method: payment.method,
        amountPaisa: payment.amountPaisa,
        reference: payment.reference ?? null,
      }));

    if (totalPaisa > 0) {
      if (paidPaisa < totalPaisa) {
        return {
          ok: false,
          reason: "underpaid",
          message: checkoutMessages.underpaid,
          duePaisa: totalPaisa - paidPaisa,
        };
      }
      changePaisa = paidPaisa - totalPaisa;
    } else if (totalPaisa === 0) {
      changePaisa = paidPaisa;
    } else {
      if (tenders.some((tender) => tender.method !== "cash")) return refundCashOnly;
      const [only] = tenders;
      if (tenders.length !== 1 || !only || only.amountPaisa !== -totalPaisa) return refundAmount;
      paymentInputs = [{ method: "cash", amountPaisa: totalPaisa, reference: null }];
    }

    const invoiceNo = takeInvoiceNumber(tx, terminal);
    const createdAt = now();
    const deletedLineCount =
      tx
        .select({ n: sql<number>`count(*)` })
        .from(billDraftLines)
        .where(and(eq(billDraftLines.draftId, draft.id), isNotNull(billDraftLines.deletedAt)))
        .get()?.n ?? 0;

    const sale = tx
      .insert(sales)
      .values({
        ...saleRow({
          storeId: terminal.storeId,
          terminalId: terminal.id,
          shiftId,
          draftId: draft.id,
          invoiceNo,
          cashierUserId: session.userId,
          refundedSaleId: null,
          pricesIncludeTax: settings.pricesIncludeTax,
          totals: computed.totals,
          deletedLineCount,
          buyer: buyerOf(input.buyer),
        }),
        createdAt,
      })
      .returning()
      .get();
    const saleRef = { id: sale.id, storeId: terminal.storeId, terminalId: terminal.id };

    const lineValues = rows.map(({ line, product, categoryRateBps }, index) => {
      const amounts = computed.lines[index];
      if (!amounts) throw new Error("Totals are out of step with the lines");
      return {
        ...saleLineRow({
          sale: { ...saleRef, refundedSaleId: null },
          position: index,
          product,
          taxRateBps: rateOf(categoryRateBps),
          line,
          amounts,
        }),
        createdAt,
      };
    });
    const insertedLines = tx
      .insert(saleLines)
      .values(lineValues)
      .returning({ id: saleLines.id, position: saleLines.position })
      .all();
    const lineIdByPosition = new Map(insertedLines.map((row) => [row.position, row.id]));

    const paymentValues = paymentInputs.map((payment, index) => ({
      ...paymentRow({
        sale: saleRef,
        position: index,
        method: payment.method,
        amountPaisa: payment.amountPaisa,
        reference: payment.reference,
        cashierUserId: session.userId,
      }),
      createdAt,
    }));
    if (changePaisa > 0) {
      paymentValues.push({
        ...changeRow({
          sale: saleRef,
          position: paymentValues.length,
          changePaisa,
          cashierUserId: session.userId,
        }),
        createdAt,
      });
    }
    if (paymentValues.length > 0) tx.insert(salePayments).values(paymentValues).run();

    for (const [index, { line, product }] of rows.entries()) {
      if (product.isSystem) continue;
      const lineId = lineIdByPosition.get(index);
      if (!lineId) throw new Error("Sale line was not stored");
      stock.record(tx, {
        productId: product.id,
        type: line.isReturn ? "return" : "sale",
        qtyMilli: divRoundHalfUp(-BigInt(line.qtyMilli) * BigInt(line.packQtyMilli), 1000n),
        sourceType: "sale_line",
        sourceId: lineId,
        actorUserId: session.userId,
      });
    }

    tx.update(billDrafts)
      .set({ state: "paid", updatedAt: createdAt })
      .where(eq(billDrafts.id, draft.id))
      .run();

    audit.record(
      {
        action: "sale_complete",
        actorUserId: session.userId,
        entityType: "sale",
        entityId: sale.id,
        details: { invoiceNo, totalPaisa, lineCount: rows.length },
      },
      tx,
    );
    const returnLines = computed.lines.filter((_, index) => rows[index]?.line.isReturn);
    if (returnLines.length > 0) {
      audit.record(
        {
          action: "return",
          actorUserId: session.userId,
          entityType: "sale",
          entityId: sale.id,
          details: {
            invoiceNo,
            returnLineCount: returnLines.length,
            returnTotalPaisa: returnLines.reduce((acc, line) => acc + line.totalPaisa, 0),
          },
        },
        tx,
      );
    }

    return {
      ok: true,
      sale: {
        id: sale.id,
        invoiceNo,
        type: sale.type,
        totalPaisa,
        roundingPaisa: computed.totals.roundingPaisa,
        changePaisa,
        createdAt: createdAt.toISOString(),
        replayed: false,
      },
    };
  }

  function complete(input: CompleteSaleInput): CompleteSaleResult {
    const session = requireSession(sessions);
    try {
      return db.transaction((tx) => completeInTransaction(tx, input, session));
    } catch (error) {
      if (isUniqueViolation(error)) {
        const replay = replayOf(db, input.draftId);
        if (replay) return replay;
      }
      throw error;
    }
  }

  return { complete };
}

export type SalesService = ReturnType<typeof createSalesService>;
