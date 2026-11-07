import { z } from "zod";
import { isoSchema, maxPaisa, paisaSchema, qtyMilliSchema, refusal } from "./checkout";
import { productUnits } from "./products";
import { purchaseOrderMessages } from "./purchase-orders";

export const goodsReceivedMessages = {
  supplierUnavailable: purchaseOrderMessages.supplierUnavailable,
  productUnavailable: purchaseOrderMessages.productUnavailable,
  orderNotFound: purchaseOrderMessages.notFound,
  orderNotReceivable: "Only a confirmed purchase order with goods still to come can be received.",
  orderLineUnavailable: "One of the lines is no longer on this purchase order. Refresh the order.",
  notFound: "That goods received note no longer exists.",
} as const;

function checkLineTotal(line: { qtyMilli: number; unitCostPaisa: number }, ctx: z.RefinementCtx) {
  if (BigInt(line.qtyMilli) * BigInt(line.unitCostPaisa) > BigInt(maxPaisa) * 1000n) {
    ctx.addIssue({ code: "custom", path: ["qtyMilli"], message: "Line total is too large." });
  }
}

const supplierInvoiceNoSchema = z
  .string()
  .trim()
  .min(1, "Enter the supplier's invoice number.")
  .max(64, "Invoice number is up to 64 characters.");

const directLineSchema = z
  .strictObject({
    productId: z.uuid(),
    qtyMilli: qtyMilliSchema,
    unitCostPaisa: paisaSchema,
  })
  .superRefine(checkLineTotal);

const orderLineSchema = z
  .strictObject({
    purchaseOrderLineId: z.uuid(),
    qtyMilli: qtyMilliSchema,
    unitCostPaisa: paisaSchema,
  })
  .superRefine(checkLineTotal);

export const postGoodsReceivedInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("direct"),
    supplierId: z.uuid(),
    supplierInvoiceNo: supplierInvoiceNoSchema,
    lines: z.array(directLineSchema).min(1, "Add at least one line.").max(1000),
  }),
  z.strictObject({
    kind: z.literal("order"),
    purchaseOrderId: z.uuid(),
    supplierInvoiceNo: supplierInvoiceNoSchema,
    lines: z.array(orderLineSchema).min(1, "Add at least one line.").max(1000),
  }),
]);

export const goodsReceivedLineSchema = z.strictObject({
  id: z.string(),
  productId: z.string(),
  purchaseOrderLineId: z.string().nullable(),
  nameEn: z.string(),
  nameUr: z.string().nullable(),
  unit: z.enum(productUnits),
  qtyMilli: z.int(),
  unitCostPaisa: z.int(),
  lineTotalPaisa: z.int(),
});

export const goodsReceivedNoteSchema = z.strictObject({
  id: z.string(),
  grnNo: z.string(),
  supplierId: z.string(),
  supplierName: z.string(),
  purchaseOrderId: z.string().nullable(),
  orderNo: z.string().nullable(),
  supplierInvoiceNo: z.string(),
  totalPaisa: z.int(),
  createdAt: isoSchema,
  lines: z.array(goodsReceivedLineSchema),
});

export const postGoodsReceivedResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), note: goodsReceivedNoteSchema }),
  refusal("supplier-unavailable"),
  refusal("product-unavailable"),
  refusal("whole-units"),
  refusal("order-not-found"),
  refusal("order-not-receivable"),
  refusal("order-line-unavailable"),
]);

export const GOODS_RECEIVED_MAX_LIMIT = 100;

export const goodsReceivedListQuerySchema = z.strictObject({
  supplierId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.int().min(1).max(GOODS_RECEIVED_MAX_LIMIT),
  offset: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
});
export const goodsReceivedIdInputSchema = z.strictObject({ id: z.uuid() });

export const goodsReceivedLastCostInputSchema = z.strictObject({ productId: z.uuid() });

export const goodsReceivedSummarySchema = z.strictObject({
  id: z.string(),
  grnNo: z.string(),
  supplierId: z.string(),
  supplierName: z.string(),
  purchaseOrderId: z.string().nullable(),
  orderNo: z.string().nullable(),
  supplierInvoiceNo: z.string(),
  lineCount: z.int(),
  totalPaisa: z.int(),
  createdAt: isoSchema,
});

export const goodsReceivedListResultSchema = z.strictObject({
  items: z.array(goodsReceivedSummarySchema),
  total: z.int(),
});

export const getGoodsReceivedResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), note: goodsReceivedNoteSchema }),
  refusal("not-found"),
]);

export const goodsReceivedLastCostResultSchema = z.strictObject({
  unitCostPaisa: z.int().nullable(),
});

export type GoodsReceivedLine = z.infer<typeof goodsReceivedLineSchema>;
export type GoodsReceivedNote = z.infer<typeof goodsReceivedNoteSchema>;
export type PostGoodsReceivedInput = z.input<typeof postGoodsReceivedInputSchema>;
export type PostGoodsReceivedResult = z.infer<typeof postGoodsReceivedResultSchema>;
export type GoodsReceivedSummary = z.infer<typeof goodsReceivedSummarySchema>;
export type GoodsReceivedListQuery = z.input<typeof goodsReceivedListQuerySchema>;
export type GoodsReceivedListResult = z.infer<typeof goodsReceivedListResultSchema>;
export type GetGoodsReceivedResult = z.infer<typeof getGoodsReceivedResultSchema>;
export type GoodsReceivedLastCostResult = z.infer<typeof goodsReceivedLastCostResultSchema>;
