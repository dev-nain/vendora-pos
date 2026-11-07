import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { checkoutMessages } from "../../shared/checkout";
import {
  purchaseReturnMessages,
  type PostPurchaseReturnResult,
  type PurchaseReturn,
  type ReturnableInput,
  type ReturnableNoteResult,
  type ReturnableResult,
  type postPurchaseReturnInputSchema,
} from "../../shared/purchase-returns";
import { purchaseOrderLineTotalPaisa, purchaseOrderTotalPaisa } from "../../shared/purchase-orders";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { takePurchaseReturnNumber } from "../db/purchase-return-numbers";
import {
  goodsReceivedLines,
  goodsReceivedNotes,
  products,
  purchaseReturnLines,
  purchaseReturns,
  suppliers,
  users,
} from "../db/schema";
import { currentTerminal, type DbExecutor } from "../db/terminal";
import type { createAuditService } from "./audit";
import { findLiveSupplier } from "./goods-received";
import type { StockService } from "./stock";

type PostInput = z.output<typeof postPurchaseReturnInputSchema>;
type ProductRow = typeof products.$inferSelect;
type ReturnRow = typeof purchaseReturns.$inferSelect;
type ReturnLineRow = typeof purchaseReturnLines.$inferSelect;

interface ResolvedLine {
  productId: string;
  goodsReceivedLineId: string | null;
  qtyMilli: number;
  unitCostPaisa: number;
}

interface PurchaseReturnsDeps {
  database: VendoraDatabase;
  audit: ReturnType<typeof createAuditService>;
  sessions: SessionStore;
  stock: Pick<StockService, "record">;
  now?: () => Date;
}

const refuse = <Reason extends string>(reason: Reason, message: string) =>
  ({ ok: false, reason, message }) as const;

const supplierUnavailable = refuse(
  "supplier-unavailable",
  purchaseReturnMessages.supplierUnavailable,
);
const productUnavailable = refuse("product-unavailable", purchaseReturnMessages.productUnavailable);
const wholeUnits = refuse("whole-units", checkoutMessages.wholeUnits);
const notReceived = refuse("not-received", purchaseReturnMessages.notReceived);
const noteNotFound = refuse("note-not-found", purchaseReturnMessages.noteNotFound);
const lineUnavailable = refuse("line-unavailable", purchaseReturnMessages.lineUnavailable);
const overReturnable = refuse("over-returnable", purchaseReturnMessages.overReturnable);

const isReturnable = (product: ProductRow | undefined): product is ProductRow =>
  product !== undefined && product.deletedAt === null && !product.isSystem;

function receivedFromSupplier(
  tx: DbExecutor,
  storeId: string,
  supplierId: string,
  productIds: string[],
): Map<string, number> {
  if (productIds.length === 0) return new Map();
  return new Map(
    tx
      .select({
        productId: goodsReceivedLines.productId,
        qtyMilli: sql<number>`sum(${goodsReceivedLines.qtyMilli})`.mapWith(Number),
      })
      .from(goodsReceivedLines)
      .innerJoin(
        goodsReceivedNotes,
        eq(goodsReceivedNotes.id, goodsReceivedLines.goodsReceivedNoteId),
      )
      .where(
        and(
          eq(goodsReceivedNotes.storeId, storeId),
          eq(goodsReceivedNotes.supplierId, supplierId),
          inArray(goodsReceivedLines.productId, productIds),
        ),
      )
      .groupBy(goodsReceivedLines.productId)
      .all()
      .map((row) => [row.productId, row.qtyMilli] as const),
  );
}

function returnedToSupplier(
  tx: DbExecutor,
  storeId: string,
  supplierId: string,
  productIds: string[],
): Map<string, number> {
  if (productIds.length === 0) return new Map();
  return new Map(
    tx
      .select({
        productId: purchaseReturnLines.productId,
        qtyMilli: sql<number>`sum(${purchaseReturnLines.qtyMilli})`.mapWith(Number),
      })
      .from(purchaseReturnLines)
      .innerJoin(purchaseReturns, eq(purchaseReturns.id, purchaseReturnLines.purchaseReturnId))
      .where(
        and(
          eq(purchaseReturns.storeId, storeId),
          eq(purchaseReturns.supplierId, supplierId),
          inArray(purchaseReturnLines.productId, productIds),
        ),
      )
      .groupBy(purchaseReturnLines.productId)
      .all()
      .map((row) => [row.productId, row.qtyMilli] as const),
  );
}

function returnedAgainstLines(tx: DbExecutor, lineIds: string[]): Map<string, number> {
  if (lineIds.length === 0) return new Map();
  return new Map(
    tx
      .select({
        lineId: purchaseReturnLines.goodsReceivedLineId,
        qtyMilli: sql<number>`sum(${purchaseReturnLines.qtyMilli})`.mapWith(Number),
      })
      .from(purchaseReturnLines)
      .where(inArray(purchaseReturnLines.goodsReceivedLineId, lineIds))
      .groupBy(purchaseReturnLines.goodsReceivedLineId)
      .all()
      .map((row) => [row.lineId!, row.qtyMilli] as const),
  );
}

function lastSupplierCost(
  tx: DbExecutor,
  storeId: string,
  supplierId: string,
  productId: string,
): number | null {
  const row = tx
    .select({ unitCostPaisa: goodsReceivedLines.unitCostPaisa })
    .from(goodsReceivedLines)
    .innerJoin(
      goodsReceivedNotes,
      eq(goodsReceivedNotes.id, goodsReceivedLines.goodsReceivedNoteId),
    )
    .where(
      and(
        eq(goodsReceivedNotes.storeId, storeId),
        eq(goodsReceivedNotes.supplierId, supplierId),
        eq(goodsReceivedLines.productId, productId),
      ),
    )
    .orderBy(desc(goodsReceivedLines.createdAt), desc(goodsReceivedLines.position))
    .limit(1)
    .get();
  return row?.unitCostPaisa ?? null;
}

function supplierCaps(
  tx: DbExecutor,
  storeId: string,
  supplierId: string,
  productIds: string[],
): Map<string, number> {
  const received = receivedFromSupplier(tx, storeId, supplierId, productIds);
  const returned = returnedToSupplier(tx, storeId, supplierId, productIds);
  return new Map(
    productIds.map((id) => [id, Math.max(0, (received.get(id) ?? 0) - (returned.get(id) ?? 0))]),
  );
}

function loadProducts(tx: DbExecutor, storeId: string, productIds: string[]) {
  const found = tx
    .select()
    .from(products)
    .where(and(eq(products.storeId, storeId), inArray(products.id, productIds)))
    .all();
  return new Map(found.map((product) => [product.id, product]));
}

function toReturn(tx: DbExecutor, header: ReturnRow, lines: ReturnLineRow[]): PurchaseReturn {
  const supplier = tx
    .select({ name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.id, header.supplierId))
    .get();
  const note = header.goodsReceivedNoteId
    ? tx
        .select({
          grnNo: goodsReceivedNotes.grnNo,
          supplierInvoiceNo: goodsReceivedNotes.supplierInvoiceNo,
        })
        .from(goodsReceivedNotes)
        .where(eq(goodsReceivedNotes.id, header.goodsReceivedNoteId))
        .get()
    : undefined;
  const actor = tx
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, header.actorUserId))
    .get();
  return {
    id: header.id,
    returnNo: header.returnNo,
    supplierId: header.supplierId,
    supplierName: supplier?.name ?? "",
    goodsReceivedNoteId: header.goodsReceivedNoteId,
    grnNo: note?.grnNo ?? null,
    supplierInvoiceNo: note?.supplierInvoiceNo ?? null,
    reason: header.reason,
    notes: header.notes,
    totalPaisa: header.totalPaisa,
    actorName: actor?.displayName ?? "",
    createdAt: header.createdAt.toISOString(),
    lines: lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      goodsReceivedLineId: line.goodsReceivedLineId,
      nameEn: line.nameEn,
      nameUr: line.nameUr,
      unit: line.unit,
      qtyMilli: line.qtyMilli,
      unitCostPaisa: line.unitCostPaisa,
      lineTotalPaisa: line.lineTotalPaisa,
    })),
  };
}

function resolveSupplierLines(
  tx: DbExecutor,
  storeId: string,
  input: PostInput & { kind: "supplier" },
) {
  if (!findLiveSupplier(tx, storeId, input.supplierId)) return supplierUnavailable;
  const lines: ResolvedLine[] = [];
  for (const line of input.lines) {
    const cost = lastSupplierCost(tx, storeId, input.supplierId, line.productId);
    if (cost === null) return notReceived;
    lines.push({
      productId: line.productId,
      goodsReceivedLineId: null,
      qtyMilli: line.qtyMilli,
      unitCostPaisa: cost,
    });
  }
  return { supplierId: input.supplierId, noteId: null, noteLineCaps: null, lines };
}

function resolveNoteLines(tx: DbExecutor, storeId: string, input: PostInput & { kind: "note" }) {
  const note = tx
    .select()
    .from(goodsReceivedNotes)
    .where(
      and(
        eq(goodsReceivedNotes.id, input.goodsReceivedNoteId),
        eq(goodsReceivedNotes.storeId, storeId),
      ),
    )
    .get();
  if (!note) return noteNotFound;
  if (!findLiveSupplier(tx, storeId, note.supplierId)) return supplierUnavailable;
  const noteLines = tx
    .select()
    .from(goodsReceivedLines)
    .where(eq(goodsReceivedLines.goodsReceivedNoteId, note.id))
    .all();
  const byId = new Map(noteLines.map((line) => [line.id, line]));
  const lines: ResolvedLine[] = [];
  for (const line of input.lines) {
    const noteLine = byId.get(line.goodsReceivedLineId);
    if (!noteLine) return lineUnavailable;
    lines.push({
      productId: noteLine.productId,
      goodsReceivedLineId: noteLine.id,
      qtyMilli: line.qtyMilli,
      unitCostPaisa: noteLine.unitCostPaisa,
    });
  }
  return { supplierId: note.supplierId, noteId: note.id, noteLineCaps: byId, lines };
}

export function createPurchaseReturnsService({
  database,
  audit,
  sessions,
  stock,
  now = () => new Date(),
}: PurchaseReturnsDeps) {
  const { db } = database;

  function post(input: PostInput): PostPurchaseReturnResult {
    const session = requireSession(sessions);
    return db.transaction((tx): PostPurchaseReturnResult => {
      const resolved =
        input.kind === "supplier"
          ? resolveSupplierLines(tx, session.storeId, input)
          : resolveNoteLines(tx, session.storeId, input);
      if ("ok" in resolved) return resolved;
      const { supplierId, noteId, noteLineCaps, lines } = resolved;

      const productIds = [...new Set(lines.map((line) => line.productId))];
      const productById = loadProducts(tx, session.storeId, productIds);
      for (const line of lines) {
        const product = productById.get(line.productId);
        if (!isReturnable(product)) return productUnavailable;
        if (product.unit === "piece" && line.qtyMilli % 1000 !== 0) return wholeUnits;
      }

      const asked = new Map<string, number>();
      for (const line of lines) {
        asked.set(line.productId, (asked.get(line.productId) ?? 0) + line.qtyMilli);
      }
      const caps = supplierCaps(tx, session.storeId, supplierId, productIds);
      for (const [productId, qtyMilli] of asked) {
        if (qtyMilli > (caps.get(productId) ?? 0)) return overReturnable;
      }
      if (noteLineCaps) {
        const already = returnedAgainstLines(
          tx,
          lines.map((line) => line.goodsReceivedLineId!),
        );
        for (const line of lines) {
          const left =
            noteLineCaps.get(line.goodsReceivedLineId!)!.qtyMilli -
            (already.get(line.goodsReceivedLineId!) ?? 0);
          if (line.qtyMilli > left) return overReturnable;
        }
      }

      const lineTotals = lines.map((line) =>
        purchaseOrderLineTotalPaisa(line.qtyMilli, line.unitCostPaisa),
      );
      const totalPaisa = purchaseOrderTotalPaisa(lineTotals);

      const terminal = currentTerminal(tx);
      const returnNo = takePurchaseReturnNumber(tx, terminal);
      const header = tx
        .insert(purchaseReturns)
        .values({
          storeId: session.storeId,
          terminalId: terminal.id,
          returnNo,
          supplierId,
          goodsReceivedNoteId: noteId,
          reason: input.reason,
          notes: input.notes,
          totalPaisa,
          actorUserId: session.userId,
          createdAt: now(),
        })
        .returning()
        .get();
      const saved = tx
        .insert(purchaseReturnLines)
        .values(
          lines.map((line, position) => {
            const product = productById.get(line.productId)!;
            return {
              storeId: session.storeId,
              terminalId: terminal.id,
              purchaseReturnId: header.id,
              position,
              productId: line.productId,
              goodsReceivedLineId: line.goodsReceivedLineId,
              nameEn: product.nameEn,
              nameUr: product.nameUr,
              unit: product.unit,
              qtyMilli: line.qtyMilli,
              unitCostPaisa: line.unitCostPaisa,
              lineTotalPaisa: lineTotals[position]!,
              createdAt: header.createdAt,
            };
          }),
        )
        .returning()
        .all()
        .toSorted((a, b) => a.position - b.position);

      for (const line of saved) {
        stock.record(tx, {
          productId: line.productId,
          type: "purchase_return",
          qtyMilli: -line.qtyMilli,
          sourceType: "purchase_return_line",
          sourceId: line.id,
          actorUserId: session.userId,
        });
      }

      audit.record(
        {
          action: "purchase_return_post",
          actorUserId: session.userId,
          entityType: "purchase_return",
          entityId: header.id,
          details: {
            returnNo,
            supplierId,
            goodsReceivedNoteId: noteId,
            reason: input.reason,
            totalPaisa,
            lineCount: saved.length,
          },
        },
        tx,
      );

      return { ok: true, purchaseReturn: toReturn(tx, header, saved) };
    });
  }

  function returnable({ supplierId, productId }: ReturnableInput): ReturnableResult {
    const session = requireSession(sessions);
    if (!findLiveSupplier(db, session.storeId, supplierId)) return supplierUnavailable;
    const product = loadProducts(db, session.storeId, [productId]).get(productId);
    if (!isReturnable(product)) return productUnavailable;
    const unitCostPaisa = lastSupplierCost(db, session.storeId, supplierId, productId);
    if (unitCostPaisa === null) return notReceived;
    return {
      ok: true,
      product: {
        id: product.id,
        nameEn: product.nameEn,
        nameUr: product.nameUr,
        unit: product.unit,
      },
      unitCostPaisa,
      returnableQtyMilli: supplierCaps(db, session.storeId, supplierId, [productId]).get(
        productId,
      )!,
    };
  }

  function fromNote({ id }: { id: string }): ReturnableNoteResult {
    const session = requireSession(sessions);
    const note = db
      .select({
        id: goodsReceivedNotes.id,
        grnNo: goodsReceivedNotes.grnNo,
        supplierId: goodsReceivedNotes.supplierId,
        supplierName: suppliers.name,
        supplierInvoiceNo: goodsReceivedNotes.supplierInvoiceNo,
        createdAt: goodsReceivedNotes.createdAt,
      })
      .from(goodsReceivedNotes)
      .innerJoin(suppliers, eq(suppliers.id, goodsReceivedNotes.supplierId))
      .where(and(eq(goodsReceivedNotes.id, id), eq(goodsReceivedNotes.storeId, session.storeId)))
      .get();
    if (!note) return refuse("not-found", purchaseReturnMessages.noteNotFound);

    const lines = db
      .select()
      .from(goodsReceivedLines)
      .where(eq(goodsReceivedLines.goodsReceivedNoteId, note.id))
      .orderBy(asc(goodsReceivedLines.position))
      .all();
    const already = returnedAgainstLines(
      db,
      lines.map((line) => line.id),
    );
    const caps = supplierCaps(db, session.storeId, note.supplierId, [
      ...new Set(lines.map((line) => line.productId)),
    ]);
    return {
      ok: true,
      note: { ...note, createdAt: note.createdAt.toISOString() },
      lines: lines.map((line) => ({
        goodsReceivedLineId: line.id,
        productId: line.productId,
        nameEn: line.nameEn,
        nameUr: line.nameUr,
        unit: line.unit,
        receivedQtyMilli: line.qtyMilli,
        unitCostPaisa: line.unitCostPaisa,
        returnableQtyMilli: Math.max(
          0,
          Math.min(line.qtyMilli - (already.get(line.id) ?? 0), caps.get(line.productId) ?? 0),
        ),
      })),
    };
  }

  return { post, returnable, fromNote };
}
export type PurchaseReturnsService = ReturnType<typeof createPurchaseReturnsService>;
