import { z } from "zod";
import { refusal } from "./checkout";
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
const movementReasons = ["damage", "expiry", "theft", "correction"] as const;

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
