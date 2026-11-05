import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { checkoutMessages, type BillResult } from "../../shared/checkout";
import { returnMessages, type AddFromSaleInput, type ReturnableResult } from "../../shared/returns";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import { leftQtyMilli, loadLinkedOriginals } from "../checkout/linked-lines";
import type { VendoraDatabase } from "../db/client";
import { billDraftLines, billDrafts, saleLines, sales, users } from "../db/schema";
import { currentTerminal } from "../db/terminal";
import { billOf, currentDraft, ensureDraft, runInShift } from "./bill-drafts";
import { NoOpenShiftError, requireOpenShift } from "./shifts";

interface ReturnsDeps {
  database: VendoraDatabase;
  sessions: SessionStore;
  now?: () => Date;
}

const refuse = <Reason extends string>(reason: Reason, message: string) =>
  ({ ok: false, reason, message }) as const;

const notFound = refuse("not-found", checkoutMessages.notFound);
const wholeUnits = refuse("whole-units", checkoutMessages.wholeUnits);
const oneSale = refuse("one-sale", returnMessages.oneSale);
const notReturnable = refuse("not-returnable", returnMessages.notReturnable);

export function createReturnsService({ database, sessions, now = () => new Date() }: ReturnsDeps) {
  const { db } = database;

  function returnable({ saleId }: { saleId: string }): ReturnableResult {
    const session = requireSession(sessions);
    return db.transaction((tx) => {
      const terminal = currentTerminal(tx);
      const sale = tx
        .select({
          id: sales.id,
          invoiceNo: sales.invoiceNo,
          createdAt: sales.createdAt,
          type: sales.type,
          cashierName: users.displayName,
        })
        .from(sales)
        .innerJoin(users, eq(users.id, sales.cashierUserId))
        .where(
          and(
            eq(sales.id, saleId),
            eq(sales.storeId, terminal.storeId),
            eq(sales.terminalId, terminal.id),
          ),
        )
        .get();
      if (!sale) return notFound;

      const rows = tx
        .select()
        .from(saleLines)
        .where(eq(saleLines.saleId, saleId))
        .orderBy(asc(saleLines.position))
        .all();
      const sellable = rows.filter((row) => !row.isReturn);
      const linked = loadLinkedOriginals(
        tx,
        sellable.map((row) => row.id),
      );

      let pendingOf = new Map<string, number>();
      try {
        const shift = requireOpenShift(tx, terminal.id);
        const draft = currentDraft({ tx, session, terminal, shiftId: shift.id });
        if (draft && sellable.length > 0) {
          pendingOf = new Map(
            tx
              .select({
                lineId: billDraftLines.refundedLineId,
                qtyMilli: sql<number>`coalesce(sum(-${billDraftLines.qtyMilli}), 0)`,
              })
              .from(billDraftLines)
              .where(
                and(
                  eq(billDraftLines.draftId, draft.id),
                  isNull(billDraftLines.deletedAt),
                  inArray(
                    billDraftLines.refundedLineId,
                    sellable.map((row) => row.id),
                  ),
                ),
              )
              .groupBy(billDraftLines.refundedLineId)
              .all()
              .map((row) => [row.lineId ?? "", row.qtyMilli]),
          );
        }
      } catch (error) {
        if (!(error instanceof NoOpenShiftError)) throw error;
      }

      return {
        ok: true,
        sale: {
          id: sale.id,
          invoiceNo: sale.invoiceNo,
          createdAt: sale.createdAt.toISOString(),
          cashierName: sale.cashierName,
          type: sale.type,
        },
        hasReturnLines: rows.some((row) => row.isReturn),
        lines: sellable.map((row) => {
          const entry = linked.get(row.id);
          const refundedQtyMilli = entry?.refunded.qtyMilli ?? 0;
          const pendingQtyMilli = pendingOf.get(row.id) ?? 0;
          return {
            saleLineId: row.id,
            nameEn: row.nameEn,
            nameUr: row.nameUr,
            unit: row.unit,
            packQtyMilli: row.packQtyMilli,
            unitPricePaisa: row.unitPricePaisa,
            isMisc: entry?.isSystemProduct ?? false,
            soldQtyMilli: row.qtyMilli,
            refundedQtyMilli,
            pendingQtyMilli,
            leftQtyMilli: Math.max(0, row.qtyMilli - refundedQtyMilli - pendingQtyMilli),
          };
        }),
      };
    });
  }

  function addFromSale(input: AddFromSaleInput): BillResult {
    return runInShift(database, sessions, (context) => {
      const { tx, terminal } = context;
      const sale = tx
        .select({ id: sales.id })
        .from(sales)
        .where(
          and(
            eq(sales.id, input.saleId),
            eq(sales.storeId, terminal.storeId),
            eq(sales.terminalId, terminal.id),
          ),
        )
        .get();
      if (!sale) return notFound;

      const draft = currentDraft(context);
      if (draft) {
        const otherSale = tx
          .select({ saleId: saleLines.saleId })
          .from(billDraftLines)
          .innerJoin(saleLines, eq(saleLines.id, billDraftLines.refundedLineId))
          .where(and(eq(billDraftLines.draftId, draft.id), isNull(billDraftLines.deletedAt)))
          .all()
          .some((row) => row.saleId !== sale.id);
        if (otherSale) return oneSale;
      }

      const originals = loadLinkedOriginals(
        tx,
        input.lines.map((entry) => entry.saleLineId),
      );
      const existing = draft
        ? tx
            .select()
            .from(billDraftLines)
            .where(
              and(
                eq(billDraftLines.draftId, draft.id),
                isNull(billDraftLines.deletedAt),
                inArray(
                  billDraftLines.refundedLineId,
                  input.lines.map((entry) => entry.saleLineId),
                ),
              ),
            )
            .all()
        : [];
      const existingOf = new Map(existing.map((row) => [row.refundedLineId, row]));

      for (const entry of input.lines) {
        const linked = originals.get(entry.saleLineId);
        if (!linked || linked.saleId !== sale.id) return notFound;
        if (linked.line.isReturn) return notReturnable;
        if (linked.line.unit === "piece" || linked.line.packQtyMilli !== 1000) {
          if (entry.qtyMilli % 1000 !== 0) return wholeUnits;
        }
        const pending = -(existingOf.get(entry.saleLineId)?.qtyMilli ?? 0);
        const left = leftQtyMilli(linked) - pending;
        if (entry.qtyMilli > left) {
          return refuse(
            "return-over-sold",
            returnMessages.overSold(Math.max(0, left), linked.line.unit),
          );
        }
      }

      const target = ensureDraft(context);
      let position =
        (tx
          .select({ top: sql<number>`coalesce(max(${billDraftLines.position}), -1)` })
          .from(billDraftLines)
          .where(eq(billDraftLines.draftId, target.id))
          .get()?.top ?? -1) + 1;

      for (const entry of input.lines) {
        const linked = originals.get(entry.saleLineId);
        if (!linked) continue;
        const merge = existingOf.get(entry.saleLineId);
        if (merge) {
          tx.update(billDraftLines)
            .set({ qtyMilli: merge.qtyMilli - entry.qtyMilli, updatedAt: now() })
            .where(eq(billDraftLines.id, merge.id))
            .run();
          continue;
        }
        const { line } = linked;
        tx.insert(billDraftLines)
          .values({
            storeId: terminal.storeId,
            terminalId: terminal.id,
            draftId: target.id,
            position,
            productId: line.productId,
            qtyMilli: -entry.qtyMilli,
            isReturn: true,
            refundedLineId: line.id,
            unitPricePaisa: line.unitPricePaisa,
            priceType: "original",
            packQtyMilli: line.packQtyMilli,
            barcode: line.barcode,
            scaleSource: null,
            miscName: linked.isSystemProduct ? line.nameEn : null,
          })
          .run();
        position += 1;
      }
      tx.update(billDrafts).set({ updatedAt: now() }).where(eq(billDrafts.id, target.id)).run();
      return billOf(tx, target.id);
    });
  }

  return { returnable, addFromSale };
}

export type ReturnsService = ReturnType<typeof createReturnsService>;
