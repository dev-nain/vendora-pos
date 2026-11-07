import { z } from "zod";
import { maxQtyMilli, refusal } from "./checkout";
import {
  PRODUCT_SEARCH_MAX_LIMIT,
  productSearchInputSchema,
  productSearchItemSchema,
} from "./products";

const movementTypes = [
  "opening",
  "sale",
  "return",
  "receipt",
  "adjustment",
  "stocktake",
  "damage",
] as const;
export const movementReasons = ["damage", "expiry", "theft", "correction"] as const;
export type StockMovementReason = (typeof movementReasons)[number];

export const canRaiseStock = (reason: StockMovementReason): boolean => reason === "correction";

export const stockAdjustmentMessages = {
  raiseNeedsCorrection: "Only Correction can raise stock. Pick Correction.",
};

export const stockListQuerySchema = productSearchInputSchema.omit({ includeArchived: true });
export type StockListQuery = z.input<typeof stockListQuerySchema>;

export const stockListItemSchema = productSearchItemSchema.extend({
  costPaisa: z.int(),
  stockValuePaisa: z.int(),
});
export type StockListItem = z.infer<typeof stockListItemSchema>;

export const stockListResultSchema = z.strictObject({
  items: z.array(stockListItemSchema),
  total: z.number(),
});
export type StockListResult = z.infer<typeof stockListResultSchema>;

export const lowStockQuerySchema = productSearchInputSchema.pick({
  categoryId: true,
  limit: true,
  offset: true,
});
export type LowStockQuery = z.input<typeof lowStockQuerySchema>;

export const lowStockItemSchema = z.strictObject({
  id: z.string(),
  nameEn: z.string(),
  nameUr: z.string().nullable(),
  categoryId: z.string().nullable(),
  unit: productSearchItemSchema.shape.unit,
  onHandMilli: z.int(),
  thresholdMilli: z.int().nonnegative(),
  shortfallMilli: z.int().nonnegative(),
});
export type LowStockItem = z.infer<typeof lowStockItemSchema>;

export const lowStockResultSchema = z.strictObject({
  items: z.array(lowStockItemSchema),
  total: z.number(),
});
export type LowStockResult = z.infer<typeof lowStockResultSchema>;

export const STOCK_HISTORY_MAX_LIMIT = 100;

export const stockHistoryQuerySchema = z.strictObject({
  productId: z.uuid(),
  limit: z.int().min(1).max(STOCK_HISTORY_MAX_LIMIT),
  offset: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
});
export type StockHistoryQuery = z.input<typeof stockHistoryQuerySchema>;

export const stockMovementRowSchema = z.strictObject({
  id: z.string(),
  createdAt: z.iso.datetime(),
  type: z.enum(movementTypes),
  qtyMilli: z.int(),
  unitCostPaisa: z.int(),
  reason: z.enum(movementReasons).nullable(),
  userName: z.string(),
  source: z.string().nullable(),
});
export type StockMovementRow = z.infer<typeof stockMovementRowSchema>;

export const stockHistoryResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    product: z.strictObject({
      id: z.string(),
      nameEn: z.string(),
      nameUr: z.string().nullable(),
      unit: productSearchItemSchema.shape.unit,
      onHandMilli: z.int(),
      costPaisa: z.int(),
      stockValuePaisa: z.int(),
    }),
    movements: z.array(stockMovementRowSchema),
    hasMore: z.boolean(),
  }),
  refusal("not-found"),
]);
export type StockHistoryResult = z.infer<typeof stockHistoryResultSchema>;

export const negativeStockQuerySchema = z.strictObject({
  limit: z.int().min(1).max(PRODUCT_SEARCH_MAX_LIMIT),
  offset: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
});
export type NegativeStockQuery = z.input<typeof negativeStockQuerySchema>;

export const negativeStockItemSchema = z.strictObject({
  id: z.string(),
  nameEn: z.string(),
  nameUr: z.string().nullable(),
  unit: productSearchItemSchema.shape.unit,
  onHandMilli: z.int().negative(),
  stockValuePaisa: z.int(),
  lastMovementAt: z.iso.datetime(),
});
export type NegativeStockItem = z.infer<typeof negativeStockItemSchema>;

export const negativeStockResultSchema = z.strictObject({
  items: z.array(negativeStockItemSchema),
  total: z.number(),
});
export type NegativeStockResult = z.infer<typeof negativeStockResultSchema>;

export const stockAdjustmentInputSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("change"),
    productId: z.uuid(),
    qtyMilli: z
      .int()
      .min(-maxQtyMilli)
      .max(maxQtyMilli)
      .refine((value) => value !== 0, "Quantity must not be zero"),
    reason: z.enum(movementReasons),
  }),
  z.strictObject({
    mode: z.literal("count"),
    productId: z.uuid(),
    countedMilli: z.int().min(0).max(maxQtyMilli),
    reason: z.enum(movementReasons),
  }),
]);
export type StockAdjustmentInput = z.input<typeof stockAdjustmentInputSchema>;

export const stockAdjustmentResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), changed: z.boolean(), onHandMilli: z.int() }),
  refusal("not-found"),
  refusal("raise-needs-correction"),
]);
export type StockAdjustmentResult = z.infer<typeof stockAdjustmentResultSchema>;
