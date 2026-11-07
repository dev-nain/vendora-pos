import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";
import { checkoutMessages } from "../../shared/checkout";
import type { ProductUnit } from "../../shared/products";
import {
  derivePurchaseOrderStatus,
  purchaseOrderLineTotalPaisa,
  purchaseOrderMessages,
  purchaseOrderTotalPaisa,
  remainingQtyMilli,
  type CancelPurchaseOrderResult,
  type ConfirmPurchaseOrderResult,
  type CreatePurchaseOrderResult,
  type GetPurchaseOrderResult,
  type PurchaseOrder,
  type PurchaseOrderSummary,
  type UpdatePurchaseOrderResult,
  type createPurchaseOrderInputSchema,
  type purchaseOrderIdInputSchema,
  type updatePurchaseOrderInputSchema,
} from "../../shared/purchase-orders";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { takePurchaseOrderNumber } from "../db/purchase-order-numbers";
import { products, purchaseOrderLines, purchaseOrders, suppliers, users } from "../db/schema";
import { currentTerminal, type DbExecutor } from "../db/terminal";
import type { createAuditService } from "./audit";

type CreateInput = z.output<typeof createPurchaseOrderInputSchema>;
type UpdateInput = z.output<typeof updatePurchaseOrderInputSchema>;
type IdInput = z.output<typeof purchaseOrderIdInputSchema>;
type LineInput = CreateInput["lines"][number];

interface PurchaseOrdersDeps {
  database: VendoraDatabase;
  audit: ReturnType<typeof createAuditService>;
  sessions: SessionStore;
  now?: () => Date;
}

type OrderRow = typeof purchaseOrders.$inferSelect;
type LineRow = typeof purchaseOrderLines.$inferSelect;

type Snapshot = { nameEn: string; nameUr: string | null; unit: ProductUnit };

const refuse = <Reason extends string>(reason: Reason, message: string) =>
  ({ ok: false, reason, message }) as const;

const notFound = refuse("not-found", purchaseOrderMessages.notFound);
const notEditable = refuse("not-editable", purchaseOrderMessages.notEditable);
const notConfirmable = refuse("not-confirmable", purchaseOrderMessages.notConfirmable);
const notCancellable = refuse("not-cancellable", purchaseOrderMessages.notCancellable);
const supplierUnavailable = refuse(
  "supplier-unavailable",
  purchaseOrderMessages.supplierUnavailable,
);
const productUnavailable = refuse("product-unavailable", purchaseOrderMessages.productUnavailable);
const wholeUnits = refuse("whole-units", checkoutMessages.wholeUnits);

const statusOf = (order: OrderRow, lines: readonly LineRow[]) =>
  derivePurchaseOrderStatus(order.status, lines);

const hasReceipt = (lines: readonly LineRow[]) => lines.some((line) => line.receivedQtyMilli > 0);

function liveLines(tx: DbExecutor, orderId: string): LineRow[] {
  return tx
    .select()
    .from(purchaseOrderLines)
    .where(
      and(eq(purchaseOrderLines.purchaseOrderId, orderId), isNull(purchaseOrderLines.deletedAt)),
    )
    .orderBy(asc(purchaseOrderLines.position))
    .all();
}

function findOrder(tx: DbExecutor, storeId: string, id: string): OrderRow | undefined {
  return tx
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.storeId, storeId)))
    .get();
}

function toOrder(tx: DbExecutor, order: OrderRow): PurchaseOrder {
  const lines = liveLines(tx, order.id);
  const status = statusOf(order, lines);
  const supplier = tx
    .select({ name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.id, order.supplierId))
    .get();
  const creator = tx
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, order.createdByUserId))
    .get();
  return {
    id: order.id,
    orderNo: order.orderNo,
    supplierId: order.supplierId,
    supplierName: supplier?.name ?? "",
    status,
    totalPaisa: order.totalPaisa,
    lineCount: lines.length,
    createdAt: order.createdAt.toISOString(),
    notes: order.notes,
    createdByName: creator?.displayName ?? "",
    lines: lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      nameEn: line.nameEn,
      nameUr: line.nameUr,
      unit: line.unit,
      orderedQtyMilli: line.orderedQtyMilli,
      unitCostPaisa: line.unitCostPaisa,
      lineTotalPaisa: line.lineTotalPaisa,
      receivedQtyMilli: line.receivedQtyMilli,
      remainingQtyMilli: remainingQtyMilli(status, line),
    })),
  };
}

function checkSupplier(
  tx: DbExecutor,
  storeId: string,
  supplierId: string,
  currentSupplierId: string | null,
) {
  if (supplierId === currentSupplierId) return null;
  const supplier = tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, supplierId),
        eq(suppliers.storeId, storeId),
        isNull(suppliers.deletedAt),
      ),
    )
    .get();
  return supplier ? null : supplierUnavailable;
}

function snapshotLines(
  tx: DbExecutor,
  storeId: string,
  lines: readonly LineInput[],
  existing: readonly LineRow[],
) {
  const kept = new Map<string, Snapshot>(
    existing.map((line) => [
      line.productId,
      { nameEn: line.nameEn, nameUr: line.nameUr, unit: line.unit },
    ]),
  );
  const snapshots = new Map<string, Snapshot>();
  const wanted = [...new Set(lines.map((line) => line.productId))];
  const found = tx
    .select()
    .from(products)
    .where(and(eq(products.storeId, storeId), inArray(products.id, wanted)))
    .all();
  for (const productId of wanted) {
    const keptSnapshot = kept.get(productId);
    if (keptSnapshot) {
      snapshots.set(productId, keptSnapshot);
      continue;
    }
    const product = found.find((row) => row.id === productId);
    if (!product || product.deletedAt !== null || !product.isActive || product.isSystem) {
      return productUnavailable;
    }
    snapshots.set(productId, {
      nameEn: product.nameEn,
      nameUr: product.nameUr,
      unit: product.unit,
    });
  }
  for (const line of lines) {
    const snapshot = snapshots.get(line.productId);
    if (snapshot?.unit === "piece" && line.orderedQtyMilli % 1000 !== 0) return wholeUnits;
  }
  return snapshots;
}

function lineValues(
  storeId: string,
  terminalId: string,
  orderId: string,
  lines: readonly LineInput[],
  snapshots: ReadonlyMap<string, Snapshot>,
): (typeof purchaseOrderLines.$inferInsert)[] {
  return lines.map((line, position) => {
    const snapshot = snapshots.get(line.productId)!;
    return {
      storeId,
      terminalId,
      purchaseOrderId: orderId,
      position,
      productId: line.productId,
      nameEn: snapshot.nameEn,
      nameUr: snapshot.nameUr,
      unit: snapshot.unit,
      orderedQtyMilli: line.orderedQtyMilli,
      unitCostPaisa: line.unitCostPaisa,
      lineTotalPaisa: purchaseOrderLineTotalPaisa(line.orderedQtyMilli, line.unitCostPaisa),
    };
  });
}

const totalOf = (values: readonly { lineTotalPaisa: number }[]) =>
  purchaseOrderTotalPaisa(values.map((value) => value.lineTotalPaisa));

export function createPurchaseOrdersService({
  database,
  audit,
  sessions,
  now = () => new Date(),
}: PurchaseOrdersDeps) {
  const { db } = database;

  function list(): PurchaseOrderSummary[] {
    const session = requireSession(sessions);
    const orders = db
      .select({ order: purchaseOrders, supplierName: suppliers.name })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(eq(purchaseOrders.storeId, session.storeId))
      .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.id))
      .all();
    const linesByOrder = new Map<string, LineRow[]>();
    const lines = db
      .select()
      .from(purchaseOrderLines)
      .where(
        and(eq(purchaseOrderLines.storeId, session.storeId), isNull(purchaseOrderLines.deletedAt)),
      )
      .all();
    for (const line of lines) {
      const group = linesByOrder.get(line.purchaseOrderId);
      if (group) group.push(line);
      else linesByOrder.set(line.purchaseOrderId, [line]);
    }
    return orders.map(({ order, supplierName }) => {
      const orderLines = linesByOrder.get(order.id) ?? [];
      return {
        id: order.id,
        orderNo: order.orderNo,
        supplierId: order.supplierId,
        supplierName,
        status: statusOf(order, orderLines),
        totalPaisa: order.totalPaisa,
        lineCount: orderLines.length,
        createdAt: order.createdAt.toISOString(),
      };
    });
  }

  function get(input: IdInput): GetPurchaseOrderResult {
    const session = requireSession(sessions);
    return db.transaction((tx): GetPurchaseOrderResult => {
      const order = findOrder(tx, session.storeId, input.id);
      return order ? { ok: true, order: toOrder(tx, order) } : notFound;
    });
  }

  function create(input: CreateInput): CreatePurchaseOrderResult {
    const session = requireSession(sessions);
    return db.transaction((tx): CreatePurchaseOrderResult => {
      const supplierRefusal = checkSupplier(tx, session.storeId, input.supplierId, null);
      if (supplierRefusal) return supplierRefusal;
      const snapshots = snapshotLines(tx, session.storeId, input.lines, []);
      if ("ok" in snapshots) return snapshots;

      const terminal = currentTerminal(tx);
      const orderNo = takePurchaseOrderNumber(tx, terminal);
      const order = tx
        .insert(purchaseOrders)
        .values({
          storeId: session.storeId,
          terminalId: terminal.id,
          orderNo,
          supplierId: input.supplierId,
          status: "draft",
          totalPaisa: 0,
          notes: input.notes,
          createdByUserId: session.userId,
        })
        .returning()
        .get();
      const values = lineValues(session.storeId, terminal.id, order.id, input.lines, snapshots);
      tx.insert(purchaseOrderLines).values(values).run();
      const totalPaisa = totalOf(values);
      const saved = tx
        .update(purchaseOrders)
        .set({ totalPaisa })
        .where(eq(purchaseOrders.id, order.id))
        .returning()
        .get();
      audit.record(
        {
          action: "purchase_order_create",
          actorUserId: session.userId,
          entityType: "purchase_order",
          entityId: order.id,
          details: {
            orderNo,
            supplierId: input.supplierId,
            totalPaisa,
            lineCount: values.length,
          },
        },
        tx,
      );
      return { ok: true, order: toOrder(tx, saved) };
    });
  }

  function update(input: UpdateInput): UpdatePurchaseOrderResult {
    const session = requireSession(sessions);
    return db.transaction((tx): UpdatePurchaseOrderResult => {
      const order = findOrder(tx, session.storeId, input.id);
      if (!order) return notFound;
      const existing = liveLines(tx, order.id);
      const status = statusOf(order, existing);
      if ((status !== "draft" && status !== "confirmed") || hasReceipt(existing)) {
        return notEditable;
      }

      const supplierRefusal = checkSupplier(
        tx,
        session.storeId,
        input.supplierId,
        order.supplierId,
      );
      if (supplierRefusal) return supplierRefusal;
      const snapshots = snapshotLines(tx, session.storeId, input.lines, existing);
      if ("ok" in snapshots) return snapshots;

      const at = now();
      tx.update(purchaseOrderLines)
        .set({ deletedAt: at, updatedAt: at })
        .where(
          and(
            eq(purchaseOrderLines.purchaseOrderId, order.id),
            isNull(purchaseOrderLines.deletedAt),
          ),
        )
        .run();
      const values = lineValues(
        session.storeId,
        order.terminalId,
        order.id,
        input.lines,
        snapshots,
      );
      tx.insert(purchaseOrderLines).values(values).run();
      const saved = tx
        .update(purchaseOrders)
        .set({
          supplierId: input.supplierId,
          notes: input.notes,
          totalPaisa: totalOf(values),
          updatedAt: at,
        })
        .where(eq(purchaseOrders.id, order.id))
        .returning()
        .get();
      return { ok: true, order: toOrder(tx, saved) };
    });
  }

  function confirm(input: IdInput): ConfirmPurchaseOrderResult {
    const session = requireSession(sessions);
    return db.transaction((tx): ConfirmPurchaseOrderResult => {
      const order = findOrder(tx, session.storeId, input.id);
      if (!order) return notFound;
      if (order.status !== "draft") return notConfirmable;

      const saved = tx
        .update(purchaseOrders)
        .set({ status: "confirmed", updatedAt: now() })
        .where(eq(purchaseOrders.id, order.id))
        .returning()
        .get();
      audit.record(
        {
          action: "purchase_order_confirm",
          actorUserId: session.userId,
          entityType: "purchase_order",
          entityId: order.id,
          details: { orderNo: order.orderNo },
        },
        tx,
      );
      return { ok: true, order: toOrder(tx, saved) };
    });
  }

  function cancel(input: IdInput): CancelPurchaseOrderResult {
    const session = requireSession(sessions);
    return db.transaction((tx): CancelPurchaseOrderResult => {
      const order = findOrder(tx, session.storeId, input.id);
      if (!order) return notFound;
      const from = statusOf(order, liveLines(tx, order.id));
      if (from === "cancelled" || from === "received") return notCancellable;

      const saved = tx
        .update(purchaseOrders)
        .set({ status: "cancelled", updatedAt: now() })
        .where(eq(purchaseOrders.id, order.id))
        .returning()
        .get();
      audit.record(
        {
          action: "purchase_order_cancel",
          actorUserId: session.userId,
          entityType: "purchase_order",
          entityId: order.id,
          details: { orderNo: order.orderNo, from },
        },
        tx,
      );
      return { ok: true, order: toOrder(tx, saved) };
    });
  }

  return { list, get, create, update, confirm, cancel };
}

export type PurchaseOrdersService = ReturnType<typeof createPurchaseOrdersService>;
