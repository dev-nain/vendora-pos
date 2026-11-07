import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { VendoraDatabase } from "../db/client";
import {
  products,
  stockMovementReasons,
  stockMovements,
  terminals,
  type StockMovementReason,
  type StockMovementType,
} from "../db/schema";
import type { createAuditService } from "./audit";
import { weightedAverageCostPaisa } from "./average-cost";

type Tx = Parameters<Parameters<VendoraDatabase["db"]["transaction"]>[0]>[0];
type Executor = VendoraDatabase["db"] | Tx;

const ON_HAND_CHUNK = 500;

const recordableTypes = ["sale", "return", "receipt", "adjustment", "stocktake", "damage"] as const;
const reasonedTypes: readonly StockMovementType[] = ["adjustment", "damage"];

export const movementTypeForReason = (reason: StockMovementReason): "adjustment" | "damage" =>
  reason === "correction" ? "adjustment" : "damage";

export const recordMovementInputSchema = z
  .strictObject({
    productId: z.uuid(),
    type: z.enum(recordableTypes),
    qtyMilli: z.int(),
    unitCostPaisa: z.int().nonnegative().optional(),
    reason: z.enum(stockMovementReasons).nullable().optional(),
    sourceType: z.string().min(1).max(64).optional(),
    sourceId: z.string().min(1).max(64).optional(),
    actorUserId: z.uuid(),
  })
  .superRefine((input, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });

    if (input.qtyMilli === 0) issue("qtyMilli", "Quantity must not be zero");
    if ((input.type === "sale" || input.type === "damage") && input.qtyMilli > 0) {
      issue("qtyMilli", "Quantity must be negative");
    }
    if ((input.type === "return" || input.type === "receipt") && input.qtyMilli < 0) {
      issue("qtyMilli", "Quantity must be positive");
    }

    if (input.type === "receipt" && input.unitCostPaisa === undefined) {
      issue("unitCostPaisa", "A receipt needs a unit cost");
    }
    if (input.type !== "receipt" && input.unitCostPaisa !== undefined) {
      issue("unitCostPaisa", "Only a receipt takes a unit cost");
    }

    const hasReason = input.reason !== undefined && input.reason !== null;
    if (reasonedTypes.includes(input.type) && !hasReason) {
      issue("reason", "A reason is required");
    }
    if (!reasonedTypes.includes(input.type) && hasReason) {
      issue("reason", "This movement takes no reason");
    }
    if (
      reasonedTypes.includes(input.type) &&
      input.reason &&
      movementTypeForReason(input.reason) !== input.type
    ) {
      issue("reason", "This reason does not match the movement type");
    }

    if ((input.sourceType === undefined) !== (input.sourceId === undefined)) {
      issue("sourceId", "Source type and id go together");
    }
  });
export type RecordMovementInput = z.input<typeof recordMovementInputSchema>;

export const setOnHandInputSchema = z.strictObject({
  productId: z.uuid(),
  onHandMilli: z.int(),
  reason: z.enum(stockMovementReasons),
  actorUserId: z.uuid(),
});
export type SetOnHandInput = z.input<typeof setOnHandInputSchema>;

export const stockHistoryInputSchema = z.strictObject({
  productId: z.uuid(),
  limit: z.int().min(1).max(200).default(50),
  offset: z.int().min(0).default(0),
});
export type StockHistoryInput = z.input<typeof stockHistoryInputSchema>;

const productIdsSchema = z.array(z.uuid());

export type StockMovement = {
  id: string;
  productId: string;
  type: StockMovementType;
  qtyMilli: number;
  unitCostPaisa: number;
  sourceType: string | null;
  sourceId: string | null;
  reason: StockMovementReason | null;
  actorUserId: string;
  createdAt: Date;
};

type StockDeps = {
  database: VendoraDatabase;
  audit: ReturnType<typeof createAuditService>;
  now?: () => Date;
};

type NewMovement = {
  productId: string;
  type: StockMovementType;
  qtyMilli: number;
  unitCostPaisa?: number | undefined;
  reason?: StockMovementReason | null | undefined;
  sourceType?: string | undefined;
  sourceId?: string | undefined;
  actorUserId: string;
};

const toMovement = (row: typeof stockMovements.$inferSelect): StockMovement => ({
  id: row.id,
  productId: row.productId,
  type: row.type,
  qtyMilli: row.qtyMilli,
  unitCostPaisa: row.unitCostPaisa,
  sourceType: row.sourceType,
  sourceId: row.sourceId,
  reason: row.reason,
  actorUserId: row.actorUserId,
  createdAt: row.createdAt,
});

const onHandOf = (executor: Executor, productId: string): number =>
  executor
    .select({ total: sql<number>`coalesce(sum(${stockMovements.qtyMilli}), 0)` })
    .from(stockMovements)
    .where(eq(stockMovements.productId, productId))
    .get()?.total ?? 0;

export function createStockService({ database, audit, now = () => new Date() }: StockDeps) {
  const insertMovement = (tx: Tx, input: NewMovement) => {
    const terminal = tx
      .select({ id: terminals.id, storeId: terminals.storeId })
      .from(terminals)
      .orderBy(asc(terminals.id))
      .limit(1)
      .get();
    if (!terminal) throw new Error("No terminal is configured");

    const product = tx
      .select({ id: products.id, costPaisa: products.costPaisa })
      .from(products)
      .where(and(eq(products.id, input.productId), eq(products.storeId, terminal.storeId)))
      .get();
    if (!product) throw new Error("Product not found");

    const onHandBefore = onHandOf(tx, product.id);
    const unitCostPaisa = input.unitCostPaisa ?? product.costPaisa;

    const row = tx
      .insert(stockMovements)
      .values({
        storeId: terminal.storeId,
        terminalId: terminal.id,
        productId: product.id,
        type: input.type,
        qtyMilli: input.qtyMilli,
        unitCostPaisa,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        reason: input.reason ?? null,
        actorUserId: input.actorUserId,
        createdAt: now(),
      })
      .returning()
      .get();

    if (input.type === "receipt" || input.type === "opening") {
      const averaged = weightedAverageCostPaisa({
        onHandMilli: onHandBefore,
        averageCostPaisa: product.costPaisa,
        incomingQtyMilli: input.qtyMilli,
        incomingCostPaisa: unitCostPaisa,
      });
      if (averaged !== product.costPaisa) {
        tx.update(products)
          .set({ costPaisa: averaged, updatedAt: now() })
          .where(eq(products.id, product.id))
          .run();
        audit.record(
          {
            action: "cost_change",
            actorUserId: input.actorUserId,
            entityType: "product",
            entityId: product.id,
            details: { oldPaisa: product.costPaisa, newPaisa: averaged },
          },
          tx,
        );
      }
    }

    if (
      input.type === "adjustment" ||
      input.type === "opening" ||
      (input.type === "damage" && input.sourceType === undefined)
    ) {
      audit.record(
        {
          action: "stock_adjustment",
          actorUserId: input.actorUserId,
          entityType: "product",
          entityId: product.id,
          details: {
            movementId: row.id,
            type: input.type,
            qtyMilli: input.qtyMilli,
            reason: row.reason,
            onHandBeforeMilli: onHandBefore,
            onHandAfterMilli: onHandBefore + input.qtyMilli,
          },
        },
        tx,
      );
    }

    return toMovement(row);
  };

  return {
    record(tx: Tx, input: RecordMovementInput): StockMovement {
      return insertMovement(tx, recordMovementInputSchema.parse(input));
    },

    setOnHand(
      tx: Tx,
      input: SetOnHandInput,
    ): { movement: StockMovement | null; onHandMilli: number } {
      const { productId, onHandMilli, reason, actorUserId } = setOnHandInputSchema.parse(input);
      const current = onHandOf(tx, productId);
      const qtyMilli = onHandMilli - current;
      if (qtyMilli === 0) return { movement: null, onHandMilli: current };

      const movement = insertMovement(
        tx,
        recordMovementInputSchema.parse({
          productId,
          type: movementTypeForReason(reason),
          qtyMilli,
          reason,
          actorUserId,
        }),
      );
      return { movement, onHandMilli };
    },

    onHand(productId: string, executor: Executor = database.db): number {
      return onHandOf(executor, z.uuid().parse(productId));
    },

    onHandMany(productIds: string[], executor: Executor = database.db): Map<string, number> {
      const ids = [...new Set(productIdsSchema.parse(productIds))];
      const totals = new Map(ids.map((id) => [id, 0]));
      for (let start = 0; start < ids.length; start += ON_HAND_CHUNK) {
        const rows = executor
          .select({
            productId: stockMovements.productId,
            total: sql<number>`sum(${stockMovements.qtyMilli})`,
          })
          .from(stockMovements)
          .where(inArray(stockMovements.productId, ids.slice(start, start + ON_HAND_CHUNK)))
          .groupBy(stockMovements.productId)
          .all();
        for (const row of rows) totals.set(row.productId, row.total);
      }
      return totals;
    },

    history(input: StockHistoryInput, executor: Executor = database.db): StockMovement[] {
      const { productId, limit, offset } = stockHistoryInputSchema.parse(input);
      return executor
        .select()
        .from(stockMovements)
        .where(eq(stockMovements.productId, productId))
        .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
        .limit(limit)
        .offset(offset)
        .all()
        .map(toMovement);
    },
  };
}
export type StockService = ReturnType<typeof createStockService>;
