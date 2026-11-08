import { z } from "zod";
import { isoSchema, refusal } from "./checkout";
import { productUnits } from "./products";

export const PURCHASE_HISTORY_MAX_LIMIT = 100;

const pageSchema = {
  limit: z.int().min(1).max(PURCHASE_HISTORY_MAX_LIMIT),
  offset: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
};

export const productPurchaseHistoryQuerySchema = z.strictObject({
  productId: z.uuid(),
  ...pageSchema,
});
export const supplierPurchaseHistoryQuerySchema = z.strictObject({
  supplierId: z.uuid(),
  ...pageSchema,
});

export const purchaseHistoryRowSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(["receipt", "return"]),
  documentId: z.string(),
  documentNo: z.string(),
  createdAt: isoSchema,
  productId: z.string(),
  nameEn: z.string(),
  nameUr: z.string().nullable(),
  unit: z.enum(productUnits),
  supplierId: z.string(),
  supplierName: z.string(),
  qtyMilli: z.int(),
  unitCostPaisa: z.int(),
  lineTotalPaisa: z.int(),
});

export const lastReceiptSchema = z.strictObject({
  unitCostPaisa: z.int(),
  supplierId: z.string(),
  supplierName: z.string(),
  grnNo: z.string(),
  receivedAt: isoSchema,
});

export const productPurchaseHistoryResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    lastReceipt: lastReceiptSchema.nullable(),
    items: z.array(purchaseHistoryRowSchema),
    hasMore: z.boolean(),
  }),
  refusal("not-found"),
]);

export const supplierPurchaseHistoryResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    supplier: z.strictObject({ id: z.string(), name: z.string() }),
    items: z.array(purchaseHistoryRowSchema),
    hasMore: z.boolean(),
  }),
  refusal("not-found"),
]);

export type PurchaseHistoryRow = z.infer<typeof purchaseHistoryRowSchema>;
export type LastReceipt = z.infer<typeof lastReceiptSchema>;
export type ProductPurchaseHistoryQuery = z.input<typeof productPurchaseHistoryQuerySchema>;
export type SupplierPurchaseHistoryQuery = z.input<typeof supplierPurchaseHistoryQuerySchema>;
export type ProductPurchaseHistoryResult = z.infer<typeof productPurchaseHistoryResultSchema>;
export type SupplierPurchaseHistoryResult = z.infer<typeof supplierPurchaseHistoryResultSchema>;
