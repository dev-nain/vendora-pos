import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  checkoutMessages,
  paymentMethodLabels,
  type CompleteSaleInput,
  type CompleteSaleResult,
  type PaymentMethod,
} from "../../shared/checkout";
import { refundCapPaisa, returnMessages } from "../../shared/returns";
import {
  ordersListLimit,
  salesMessages,
  type GetOrderResult,
  type OrderSummary,
  type SalesListQuery,
} from "../../shared/sales";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import {
  leftQtyMilli,
  linkedAmounts,
  loadLinkedOriginals,
  loadRefundMethods,
} from "../checkout/linked-lines";
import { computeBill } from "../checkout/totals";
import { divRoundHalfUp } from "../../shared/rounding";
import type { VendoraDatabase } from "../db/client";
import { formatInvoiceNo, takeInvoiceNumber } from "../db/invoice-numbers";
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
  categories,
  products,
  receiptPrints,
  salePayments,
  saleLines,
  sales,
  taxCategories,
  users,
} from "../db/schema";
import { isUniqueViolation } from "../db/sqlite-errors";
import { currentTerminal, type DbExecutor } from "../db/terminal";
import { loadSaleSnapshot } from "../receipts/sale-snapshot";
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
const oneSale = refuse("one-sale", returnMessages.oneSale);
const notReturnable = refuse("not-returnable", returnMessages.notReturnable);

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

function invoiceMatch(terminalCode: string, text: string): string | null {
  if (!/^\d+$/.test(text)) return text.toUpperCase();
  if (text.length > 15) return null;
  return formatInvoiceNo(terminalCode, Number(text));
}

function localDayBounds(date: string): { start: Date; end: Date } {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return { start: new Date(year, month - 1, day), end: new Date(year, month - 1, day + 1) };
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
        categoryName: categories.name,
        categoryRateBps: taxCategories.rateBps,
      })
      .from(billDraftLines)
      .innerJoin(products, eq(products.id, billDraftLines.productId))
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .innerJoin(taxCategories, eq(taxCategories.id, products.taxCategoryId))
      .where(and(eq(billDraftLines.draftId, draft.id), isNull(billDraftLines.deletedAt)))
      .orderBy(asc(billDraftLines.position))
      .all();
    if (rows.length === 0) return emptyBill;

    const settings = getCheckoutSettings(tx, terminal.storeId);
    const rateOf = (rate: number | null) => resolveTaxRateBps(rate, settings.standardTaxRateBps);

    const linkedIds = rows.flatMap(({ line }) =>
      line.refundedLineId ? [line.refundedLineId] : [],
    );
    const originals = loadLinkedOriginals(tx, linkedIds);
    const pendingByOriginal = new Map<string, number>();
    for (const { line } of rows) {
      if (!line.refundedLineId) continue;
      const original = originals.get(line.refundedLineId);
      if (
        !original ||
        original.line.storeId !== terminal.storeId ||
        original.line.terminalId !== terminal.id
      ) {
        return notFound;
      }
      pendingByOriginal.set(
        line.refundedLineId,
        (pendingByOriginal.get(line.refundedLineId) ?? 0) - line.qtyMilli,
      );
    }
    const originalSaleIds = new Set([...originals.values()].map((original) => original.saleId));
    if (originalSaleIds.size > 1) return oneSale;
    const [refundedSaleId = null] = originalSaleIds;
    for (const [lineId, pending] of pendingByOriginal) {
      const original = originals.get(lineId);
      if (!original) return notFound;
      if (original.line.isReturn) return notReturnable;
      if (pending > leftQtyMilli(original)) {
        return refuse(
          "return-over-sold",
          returnMessages.overSold(Math.max(0, leftQtyMilli(original)), original.line.unit),
        );
      }
    }

    const totalsLines = (lines: typeof rows) =>
      lines.map(({ line, categoryRateBps }) => {
        const original = line.refundedLineId ? originals.get(line.refundedLineId) : undefined;
        return totalsLineOf(
          line,
          original ? original.line.taxRateBps : rateOf(categoryRateBps),
          original ? linkedAmounts(original, -line.qtyMilli) : null,
        );
      });
    const tenders = input.payments.map((payment) => ({
      method: payment.method,
      amountPaisa: payment.amountPaisa,
    }));
    const compute = (withTenders: typeof tenders) =>
      computeBill({
        lines: totalsLines(rows),
        billDiscount: toDiscount(draft.billDiscountKind, draft.billDiscountValue),
        pricesIncludeTax: settings.pricesIncludeTax,
        rounding: settings.rounding,
        tenders: withTenders,
      });
    const probe = compute([]).totals;
    const isRefund = probe.totalPaisa - probe.roundingPaisa < 0;
    const computed = compute(
      isRefund
        ? tenders.map((tender) => ({ method: tender.method, amountPaisa: -tender.amountPaisa }))
        : tenders,
    );
    const totalPaisa = computed.totals.totalPaisa;

    const unit = settings.rounding.unitPaisa;
    if (
      settings.rounding.mode !== "off" &&
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
      const nonCash = input.payments.filter((payment) => payment.method !== "cash");
      if (nonCash.length > 0 && refundedSaleId === null) return refundCashOnly;
      if (refundedSaleId !== null && nonCash.length > 0) {
        const available = new Map(
          loadRefundMethods(tx, refundedSaleId).map((row) => [row.method, row.availablePaisa]),
        );
        const linkedRefundPaisa = -computed.lines
          .filter((_, index) => rows[index]?.line.refundedLineId)
          .reduce((acc, line) => acc + line.totalPaisa, 0);
        let nonCashSoFar = 0;
        for (const method of new Set(nonCash.map((payment) => payment.method))) {
          const amountPaisa = nonCash
            .filter((payment) => payment.method === method)
            .reduce((acc, payment) => acc + payment.amountPaisa, 0);
          const cap = refundCapPaisa({
            availablePaisa: available.get(method) ?? 0,
            linkedRefundPaisa: linkedRefundPaisa - nonCashSoFar,
            netRefundPaisa: -totalPaisa,
          });
          if (amountPaisa > cap) {
            return refuse(
              "refund-over-cap",
              returnMessages.overCap(paymentMethodLabels[method], cap),
            );
          }
          nonCashSoFar += amountPaisa;
        }
      }
      if (paidPaisa !== -totalPaisa) {
        return refuse("refund-amount", returnMessages.refundExact(-totalPaisa));
      }
      paymentInputs = paymentInputs.map((payment) => ({
        ...payment,
        amountPaisa: -payment.amountPaisa,
      }));
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
          refundedSaleId,
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

    const lineValues = rows.map(({ line, product, categoryName, categoryRateBps }, index) => {
      const amounts = computed.lines[index];
      if (!amounts) throw new Error("Totals are out of step with the lines");
      const original = line.refundedLineId ? originals.get(line.refundedLineId) : undefined;
      if (original) {
        const snapshot = original.line;
        return {
          ...saleLineRow({
            sale: { ...saleRef, refundedSaleId },
            position: index,
            product: {
              id: snapshot.productId,
              nameEn: snapshot.nameEn,
              nameUr: snapshot.nameUr,
              unit: snapshot.unit,
              costPaisa: snapshot.costPaisa,
              mrpPaisa: snapshot.mrpPaisa,
              pctCode: snapshot.pctCode,
              isThirdSchedule: snapshot.isThirdSchedule,
              categoryId: snapshot.categoryId,
              categoryName: snapshot.categoryName,
            },
            taxRateBps: snapshot.taxRateBps,
            line: {
              ...line,
              unitPricePaisa: snapshot.unitPricePaisa,
              packQtyMilli: snapshot.packQtyMilli,
              barcode: snapshot.barcode,
              miscName: null,
            },
            amounts,
          }),
          createdAt,
        };
      }
      return {
        ...saleLineRow({
          sale: { ...saleRef, refundedSaleId },
          position: index,
          product: {
            ...product,
            categoryId: product.isSystem ? null : product.categoryId,
            categoryName: product.isSystem ? null : categoryName,
          },
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
      if (line.isReturn && line.isDamaged) {
        stock.record(tx, {
          productId: product.id,
          type: "damage",
          qtyMilli: divRoundHalfUp(BigInt(line.qtyMilli) * BigInt(line.packQtyMilli), 1000n),
          reason: "damage",
          sourceType: "sale_line",
          sourceId: lineId,
          actorUserId: session.userId,
        });
      }
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
    const returnRows = rows.filter(({ line }) => line.isReturn);
    if (returnRows.length > 0) {
      const withoutReceiptLineCount = returnRows.filter(({ line }) => !line.refundedLineId).length;
      const refundByMethod: Partial<Record<PaymentMethod, number>> = {};
      if (totalPaisa < 0) {
        for (const payment of input.payments) {
          refundByMethod[payment.method] =
            (refundByMethod[payment.method] ?? 0) + payment.amountPaisa;
        }
      }
      audit.record(
        {
          action: "return",
          actorUserId: session.userId,
          entityType: "sale",
          entityId: sale.id,
          details: {
            invoiceNo,
            refundedSaleId,
            refundedInvoiceNo: [...originals.values()][0]?.invoiceNo ?? null,
            linkedLineCount: returnRows.length - withoutReceiptLineCount,
            withoutReceiptLineCount,
            damagedLineCount: returnRows.filter(({ line }) => line.isDamaged).length,
            returnTotalPaisa: computed.lines
              .filter((_, index) => rows[index]?.line.isReturn)
              .reduce((acc, line) => acc + line.totalPaisa, 0),
            refundByMethod,
          },
        },
        tx,
      );
      if (withoutReceiptLineCount > 0) {
        audit.record(
          {
            action: "return_without_receipt",
            actorUserId: session.userId,
            entityType: "sale",
            entityId: sale.id,
            details: { invoiceNo, lineCount: withoutReceiptLineCount },
          },
          tx,
        );
      }
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

  function list(query: SalesListQuery): OrderSummary[] {
    requireSession(sessions);
    const terminal = currentTerminal(db);
    let condition: SQL | undefined;
    if ("scope" in query) {
      try {
        condition = eq(sales.shiftId, requireOpenShift(db, terminal.id).id);
      } catch (error) {
        if (error instanceof NoOpenShiftError) return [];
        throw error;
      }
    } else if ("invoiceNo" in query) {
      const invoiceNo = invoiceMatch(terminal.code, query.invoiceNo);
      if (invoiceNo === null) return [];
      condition = eq(sales.invoiceNo, invoiceNo);
    } else {
      const { start, end } = localDayBounds(query.date);
      condition = and(gte(sales.createdAt, start), lt(sales.createdAt, end));
    }

    const rows = db
      .select({
        id: sales.id,
        invoiceNo: sales.invoiceNo,
        createdAt: sales.createdAt,
        cashierName: users.displayName,
        totalPaisa: sales.totalPaisa,
        type: sales.type,
      })
      .from(sales)
      .innerJoin(users, eq(users.id, sales.cashierUserId))
      .where(and(eq(sales.storeId, terminal.storeId), eq(sales.terminalId, terminal.id), condition))
      .orderBy(desc(sales.createdAt), desc(sales.id))
      .limit(ordersListLimit)
      .all();
    if (rows.length === 0) return [];

    const payments = db
      .select({ saleId: salePayments.saleId, method: salePayments.method })
      .from(salePayments)
      .where(
        and(
          inArray(
            salePayments.saleId,
            rows.map((row) => row.id),
          ),
          eq(salePayments.isChange, false),
        ),
      )
      .orderBy(asc(salePayments.position))
      .all();
    const methodsOf = new Map<string, PaymentMethod[]>();
    for (const { saleId, method } of payments) {
      const methods = methodsOf.get(saleId) ?? [];
      if (!methods.includes(method)) methods.push(method);
      methodsOf.set(saleId, methods);
    }
    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      methods: methodsOf.get(row.id) ?? [],
    }));
  }

  function get({ id }: { id: string }): GetOrderResult {
    requireSession(sessions);
    const snapshot = loadSaleSnapshot(db, id);
    if (!snapshot) return { ok: false, reason: "not-found", message: salesMessages.notFound };
    const printCount =
      db.select({ n: count() }).from(receiptPrints).where(eq(receiptPrints.saleId, id)).get()?.n ??
      0;
    const { sale } = snapshot;
    return {
      ok: true,
      sale: {
        id: sale.id,
        invoiceNo: sale.invoiceNo,
        type: sale.type,
        createdAt: sale.createdAt.toISOString(),
        cashierName: snapshot.cashierName,
        refundedInvoiceNo: sale.refundedInvoiceNo,
        lines: snapshot.lines.map((line) => ({
          nameEn: line.nameEn,
          nameUr: line.nameUr,
          unit: line.unit,
          qtyMilli: line.qtyMilli,
          packQtyMilli: line.packQtyMilli,
          isReturn: line.isReturn,
          unitPricePaisa: line.unitPricePaisa,
          discountPaisa: line.discountPaisa,
          totalPaisa: line.totalPaisa,
        })),
        subtotalPaisa: sale.subtotalPaisa,
        discountPaisa: sale.discountPaisa,
        taxPaisa: sale.taxPaisa,
        roundingPaisa: sale.roundingPaisa,
        totalPaisa: sale.totalPaisa,
        changePaisa: snapshot.payments
          .filter((payment) => payment.isChange)
          .reduce((sum, payment) => sum - payment.amountPaisa, 0),
        payments: snapshot.payments
          .filter((payment) => !payment.isChange)
          .map(({ method, amountPaisa, reference }) => ({ method, amountPaisa, reference })),
        buyerName: sale.buyerName,
        buyerNtn: sale.buyerNtn,
        printCount,
      },
    };
  }

  return { complete, list, get };
}

export type SalesService = ReturnType<typeof createSalesService>;
