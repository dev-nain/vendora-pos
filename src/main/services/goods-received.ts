import { and, asc, count, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import { checkoutMessages } from "../../shared/checkout";
import {
  goodsReceivedMessages,
  type GetGoodsReceivedResult,
  type GoodsReceivedLastCostResult,
  type GoodsReceivedListQuery,
  type GoodsReceivedListResult,
  type GoodsReceivedNote,
  type PostGoodsReceivedResult,
  type postGoodsReceivedInputSchema,
} from "../../shared/goods-received";
import {
  derivePurchaseOrderStatus,
  purchaseOrderLineTotalPaisa,
  purchaseOrderTotalPaisa,
} from "../../shared/purchase-orders";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { takeGrnNumber } from "../db/grn-numbers";
import {
  goodsReceivedLines,
  goodsReceivedNotes,
  products,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
} from "../db/schema";
import { currentTerminal, type DbExecutor } from "../db/terminal";
import type { createAuditService } from "./audit";
import { localDayBounds } from "./sales";
import type { StockService } from "./stock";

type PostInput = z.output<typeof postGoodsReceivedInputSchema>;
type ReceivedLine = { productId: string; purchaseOrderLineId: string | null } & {
  qtyMilli: number;
  unitCostPaisa: number;
};

interface GoodsReceivedDeps {
  database: VendoraDatabase;
  audit: ReturnType<typeof createAuditService>;
  sessions: SessionStore;
  stock: Pick<StockService, "record">;
  now?: () => Date;
}

type NoteRow = typeof goodsReceivedNotes.$inferSelect;
type LineRow = typeof goodsReceivedLines.$inferSelect;

const refuse = <Reason extends string>(reason: Reason, message: string) =>
  ({ ok: false, reason, message }) as const;

const supplierUnavailable = refuse(
  "supplier-unavailable",
  goodsReceivedMessages.supplierUnavailable,
);
const productUnavailable = refuse("product-unavailable", goodsReceivedMessages.productUnavailable);
const wholeUnits = refuse("whole-units", checkoutMessages.wholeUnits);
const orderNotFound = refuse("order-not-found", goodsReceivedMessages.orderNotFound);
const orderNotReceivable = refuse("order-not-receivable", goodsReceivedMessages.orderNotReceivable);
const noteNotFound = refuse("not-found", goodsReceivedMessages.notFound);
const orderLineUnavailable = refuse(
  "order-line-unavailable",
  goodsReceivedMessages.orderLineUnavailable,
);

export function findLiveSupplier(tx: DbExecutor, storeId: string, supplierId: string) {
  return tx
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, supplierId),
        eq(suppliers.storeId, storeId),
        isNull(suppliers.deletedAt),
      ),
    )
    .get();
}

export function lastReceipt(tx: DbExecutor, storeId: string, productId: string) {
  return tx
    .select({
      unitCostPaisa: goodsReceivedLines.unitCostPaisa,
      supplierId: goodsReceivedNotes.supplierId,
      supplierName: suppliers.name,
      grnNo: goodsReceivedNotes.grnNo,
      receivedAt: goodsReceivedLines.createdAt,
    })
    .from(goodsReceivedLines)
    .innerJoin(
      goodsReceivedNotes,
      eq(goodsReceivedNotes.id, goodsReceivedLines.goodsReceivedNoteId),
    )
    .innerJoin(suppliers, eq(suppliers.id, goodsReceivedNotes.supplierId))
    .where(
      and(eq(goodsReceivedLines.storeId, storeId), eq(goodsReceivedLines.productId, productId)),
    )
    .orderBy(desc(goodsReceivedLines.createdAt), desc(goodsReceivedLines.position))
    .limit(1)
    .get();
}

function resolveOrder(tx: DbExecutor, storeId: string, input: PostInput & { kind: "order" }) {
  const order = tx
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, input.purchaseOrderId), eq(purchaseOrders.storeId, storeId)))
    .get();
  if (!order) return orderNotFound;
  const orderLines = tx
    .select()
    .from(purchaseOrderLines)
    .where(
      and(eq(purchaseOrderLines.purchaseOrderId, order.id), isNull(purchaseOrderLines.deletedAt)),
    )
    .orderBy(asc(purchaseOrderLines.position))
    .all();
  const status = derivePurchaseOrderStatus(order.status, orderLines);
  if (status !== "confirmed" && status !== "partly_received") return orderNotReceivable;

  const byId = new Map(orderLines.map((line) => [line.id, line]));
  const lines: ReceivedLine[] = [];
  for (const line of input.lines) {
    const orderLine = byId.get(line.purchaseOrderLineId);
    if (!orderLine) return orderLineUnavailable;
    lines.push({
      productId: orderLine.productId,
      purchaseOrderLineId: orderLine.id,
      qtyMilli: line.qtyMilli,
      unitCostPaisa: line.unitCostPaisa,
    });
  }
  return { order, lines };
}

function toNote(tx: DbExecutor, note: NoteRow, lines: LineRow[]): GoodsReceivedNote {
  const supplier = tx
    .select({ name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.id, note.supplierId))
    .get();
  const order = note.purchaseOrderId
    ? tx
        .select({ orderNo: purchaseOrders.orderNo })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, note.purchaseOrderId))
        .get()
    : undefined;
  return {
    id: note.id,
    grnNo: note.grnNo,
    supplierId: note.supplierId,
    supplierName: supplier?.name ?? "",
    purchaseOrderId: note.purchaseOrderId,
    orderNo: order?.orderNo ?? null,
    supplierInvoiceNo: note.supplierInvoiceNo,
    totalPaisa: note.totalPaisa,
    createdAt: note.createdAt.toISOString(),
    lines: lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      purchaseOrderLineId: line.purchaseOrderLineId,
      nameEn: line.nameEn,
      nameUr: line.nameUr,
      unit: line.unit,
      qtyMilli: line.qtyMilli,
      unitCostPaisa: line.unitCostPaisa,
      lineTotalPaisa: line.lineTotalPaisa,
    })),
  };
}

export function createGoodsReceivedService({
  database,
  audit,
  sessions,
  stock,
  now = () => new Date(),
}: GoodsReceivedDeps) {
  const { db } = database;

  function post(input: PostInput): PostGoodsReceivedResult {
    const session = requireSession(sessions);
    return db.transaction((tx): PostGoodsReceivedResult => {
      let supplierId: string;
      let purchaseOrderId: string | null = null;
      let lines: ReceivedLine[];
      if (input.kind === "direct") {
        if (!findLiveSupplier(tx, session.storeId, input.supplierId)) return supplierUnavailable;
        supplierId = input.supplierId;
        lines = input.lines.map((line) => ({ ...line, purchaseOrderLineId: null }));
      } else {
        const resolved = resolveOrder(tx, session.storeId, input);
        if ("ok" in resolved) return resolved;
        supplierId = resolved.order.supplierId;
        purchaseOrderId = resolved.order.id;
        lines = resolved.lines;
      }

      const found = tx
        .select()
        .from(products)
        .where(
          and(
            eq(products.storeId, session.storeId),
            inArray(products.id, [...new Set(lines.map((line) => line.productId))]),
          ),
        )
        .all();
      const productById = new Map(found.map((product) => [product.id, product]));
      for (const line of lines) {
        const product = productById.get(line.productId);
        if (!product || product.deletedAt !== null || !product.isActive || product.isSystem) {
          return productUnavailable;
        }
        if (product.unit === "piece" && line.qtyMilli % 1000 !== 0) return wholeUnits;
      }

      const lineTotals = lines.map((line) =>
        purchaseOrderLineTotalPaisa(line.qtyMilli, line.unitCostPaisa),
      );
      const totalPaisa = purchaseOrderTotalPaisa(lineTotals);

      const terminal = currentTerminal(tx);
      const grnNo = takeGrnNumber(tx, terminal);
      const note = tx
        .insert(goodsReceivedNotes)
        .values({
          storeId: session.storeId,
          terminalId: terminal.id,
          grnNo,
          supplierId,
          purchaseOrderId,
          supplierInvoiceNo: input.supplierInvoiceNo,
          totalPaisa,
          actorUserId: session.userId,
          createdAt: now(),
        })
        .returning()
        .get();
      const saved = tx
        .insert(goodsReceivedLines)
        .values(
          lines.map((line, position) => {
            const product = productById.get(line.productId)!;
            return {
              storeId: session.storeId,
              terminalId: terminal.id,
              goodsReceivedNoteId: note.id,
              position,
              productId: line.productId,
              purchaseOrderLineId: line.purchaseOrderLineId,
              nameEn: product.nameEn,
              nameUr: product.nameUr,
              unit: product.unit,
              qtyMilli: line.qtyMilli,
              unitCostPaisa: line.unitCostPaisa,
              lineTotalPaisa: lineTotals[position]!,
              createdAt: note.createdAt,
            };
          }),
        )
        .returning()
        .all()
        .toSorted((a, b) => a.position - b.position);

      for (const line of saved) {
        stock.record(tx, {
          productId: line.productId,
          type: "receipt",
          qtyMilli: line.qtyMilli,
          unitCostPaisa: line.unitCostPaisa,
          sourceType: "goods_received_line",
          sourceId: line.id,
          actorUserId: session.userId,
        });
      }

      if (purchaseOrderId) {
        for (const line of saved) {
          if (!line.purchaseOrderLineId) continue;
          tx.update(purchaseOrderLines)
            .set({
              receivedQtyMilli: sql`${purchaseOrderLines.receivedQtyMilli} + ${line.qtyMilli}`,
              updatedAt: now(),
            })
            .where(eq(purchaseOrderLines.id, line.purchaseOrderLineId))
            .run();
        }
        tx.update(purchaseOrders)
          .set({ updatedAt: now() })
          .where(eq(purchaseOrders.id, purchaseOrderId))
          .run();
      }

      audit.record(
        {
          action: "goods_received_post",
          actorUserId: session.userId,
          entityType: "goods_received_note",
          entityId: note.id,
          details: {
            grnNo,
            supplierId,
            purchaseOrderId,
            supplierInvoiceNo: input.supplierInvoiceNo,
            totalPaisa,
            lineCount: saved.length,
          },
        },
        tx,
      );

      return { ok: true, note: toNote(tx, note, saved) };
    });
  }

  function list(query: GoodsReceivedListQuery): GoodsReceivedListResult {
    const session = requireSession(sessions);
    const conditions = [eq(goodsReceivedNotes.storeId, session.storeId)];
    if (query.supplierId) conditions.push(eq(goodsReceivedNotes.supplierId, query.supplierId));
    if (query.from)
      conditions.push(gte(goodsReceivedNotes.createdAt, localDayBounds(query.from).start));
    if (query.to) conditions.push(lt(goodsReceivedNotes.createdAt, localDayBounds(query.to).end));
    const where = and(...conditions);

    const rows = db
      .select({
        id: goodsReceivedNotes.id,
        grnNo: goodsReceivedNotes.grnNo,
        supplierId: goodsReceivedNotes.supplierId,
        supplierName: suppliers.name,
        purchaseOrderId: goodsReceivedNotes.purchaseOrderId,
        orderNo: purchaseOrders.orderNo,
        supplierInvoiceNo: goodsReceivedNotes.supplierInvoiceNo,
        totalPaisa: goodsReceivedNotes.totalPaisa,
        createdAt: goodsReceivedNotes.createdAt,
      })
      .from(goodsReceivedNotes)
      .innerJoin(suppliers, eq(suppliers.id, goodsReceivedNotes.supplierId))
      .leftJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceivedNotes.purchaseOrderId))
      .where(where)
      .orderBy(desc(goodsReceivedNotes.createdAt), desc(goodsReceivedNotes.id))
      .limit(query.limit)
      .offset(query.offset)
      .all();

    const lineCounts = new Map(
      rows.length === 0
        ? []
        : db
            .select({
              noteId: goodsReceivedLines.goodsReceivedNoteId,
              lineCount: count(),
            })
            .from(goodsReceivedLines)
            .where(
              inArray(
                goodsReceivedLines.goodsReceivedNoteId,
                rows.map((row) => row.id),
              ),
            )
            .groupBy(goodsReceivedLines.goodsReceivedNoteId)
            .all()
            .map((row) => [row.noteId, row.lineCount] as const),
    );
    const total =
      db.select({ total: count() }).from(goodsReceivedNotes).where(where).get()?.total ?? 0;

    return {
      items: rows.map((row) => ({
        ...row,
        lineCount: lineCounts.get(row.id) ?? 0,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
    };
  }

  function get({ id }: { id: string }): GetGoodsReceivedResult {
    const session = requireSession(sessions);
    const note = db
      .select()
      .from(goodsReceivedNotes)
      .where(and(eq(goodsReceivedNotes.id, id), eq(goodsReceivedNotes.storeId, session.storeId)))
      .get();
    if (!note) return noteNotFound;
    const lines = db
      .select()
      .from(goodsReceivedLines)
      .where(eq(goodsReceivedLines.goodsReceivedNoteId, note.id))
      .orderBy(asc(goodsReceivedLines.position))
      .all();
    return { ok: true, note: toNote(db, note, lines) };
  }

  function lastCost({ productId }: { productId: string }): GoodsReceivedLastCostResult {
    const session = requireSession(sessions);
    return { unitCostPaisa: lastReceipt(db, session.storeId, productId)?.unitCostPaisa ?? null };
  }

  return { post, list, get, lastCost };
}
export type GoodsReceivedService = ReturnType<typeof createGoodsReceivedService>;
