import { z } from "zod";
import { isoSchema, maxPaisa, paisaSchema, qtyMilliSchema, refusal } from "./checkout";
import { productUnits } from "./products";
import { divRoundHalfUp } from "./rounding";
import { textField } from "./settings";

export const purchaseOrderStatuses = [
  "draft",
  "confirmed",
  "partly_received",
  "received",
  "cancelled",
] as const;
export type PurchaseOrderStatus = (typeof purchaseOrderStatuses)[number];

export const storedPurchaseOrderStatuses = ["draft", "confirmed", "cancelled"] as const;
export type StoredPurchaseOrderStatus = (typeof storedPurchaseOrderStatuses)[number];

export const purchaseOrderMessages = {
  notFound: "That purchase order no longer exists. Refresh the list.",
  supplierUnavailable: "That supplier is no longer available.",
  productUnavailable: "One of the products is no longer available.",
  notEditable: "This purchase order can no longer be changed.",
  notConfirmable: "Only a draft purchase order can be confirmed.",
  notCancellable: "This purchase order can't be cancelled.",
} as const;

type OrderedReceived = { orderedQtyMilli: number; receivedQtyMilli: number };

export function purchaseOrderLineTotalPaisa(
  orderedQtyMilli: number,
  unitCostPaisa: number,
): number {
  return divRoundHalfUp(BigInt(orderedQtyMilli) * BigInt(unitCostPaisa), 1000n);
}

export function purchaseOrderTotalPaisa(lineTotals: readonly number[]): number {
  return lineTotals.reduce((sum, total) => sum + total, 0);
}

export function derivePurchaseOrderStatus(
  stored: StoredPurchaseOrderStatus,
  lines: readonly OrderedReceived[],
): PurchaseOrderStatus {
  if (stored !== "confirmed") return stored;
  if (lines.length > 0 && lines.every((l) => l.receivedQtyMilli >= l.orderedQtyMilli)) {
    return "received";
  }
  if (lines.some((l) => l.receivedQtyMilli > 0)) return "partly_received";
  return "confirmed";
}

export function remainingQtyMilli(status: PurchaseOrderStatus, line: OrderedReceived): number {
  if (status === "cancelled") return 0;
  return Math.max(0, line.orderedQtyMilli - line.receivedQtyMilli);
}

export const purchaseOrderLineInputSchema = z
  .strictObject({
    productId: z.uuid(),
    orderedQtyMilli: qtyMilliSchema,
    unitCostPaisa: paisaSchema,
  })
  .superRefine((line, ctx) => {
    if (BigInt(line.orderedQtyMilli) * BigInt(line.unitCostPaisa) > BigInt(maxPaisa) * 1000n) {
      ctx.addIssue({
        code: "custom",
        path: ["orderedQtyMilli"],
        message: "Line total is too large.",
      });
    }
  });

const orderShape = {
  supplierId: z.uuid(),
  notes: textField(500, "Notes are up to 500 characters."),
  lines: z.array(purchaseOrderLineInputSchema).min(1, "Add at least one line.").max(1000),
};

export const createPurchaseOrderInputSchema = z.strictObject(orderShape);

export const updatePurchaseOrderInputSchema = z.strictObject({ id: z.uuid(), ...orderShape });

export const purchaseOrderIdInputSchema = z.strictObject({ id: z.uuid() });

export const purchaseOrderLineSchema = z.strictObject({
  id: z.string(),
  productId: z.string(),
  nameEn: z.string(),
  nameUr: z.string().nullable(),
  unit: z.enum(productUnits),
  orderedQtyMilli: z.int(),
  unitCostPaisa: z.int(),
  lineTotalPaisa: z.int(),
  receivedQtyMilli: z.int(),
  remainingQtyMilli: z.int(),
});

const summaryShape = {
  id: z.string(),
  orderNo: z.string(),
  supplierId: z.string(),
  supplierName: z.string(),
  status: z.enum(purchaseOrderStatuses),
  totalPaisa: z.int(),
  lineCount: z.int(),
  createdAt: isoSchema,
};

export const purchaseOrderSummarySchema = z.strictObject(summaryShape);

export const purchaseOrderSchema = z.strictObject({
  ...summaryShape,
  notes: z.string().nullable(),
  createdByName: z.string(),
  lines: z.array(purchaseOrderLineSchema),
});

const okOrder = z.strictObject({ ok: z.literal(true), order: purchaseOrderSchema });

export const getPurchaseOrderResultSchema = z.union([okOrder, refusal("not-found")]);

export const createPurchaseOrderResultSchema = z.union([
  okOrder,
  refusal("supplier-unavailable"),
  refusal("product-unavailable"),
  refusal("whole-units"),
]);

export const updatePurchaseOrderResultSchema = z.union([
  okOrder,
  refusal("not-found"),
  refusal("not-editable"),
  refusal("supplier-unavailable"),
  refusal("product-unavailable"),
  refusal("whole-units"),
]);

export const confirmPurchaseOrderResultSchema = z.union([
  okOrder,
  refusal("not-found"),
  refusal("not-confirmable"),
]);

export const cancelPurchaseOrderResultSchema = z.union([
  okOrder,
  refusal("not-found"),
  refusal("not-cancellable"),
]);

export type PurchaseOrderLine = z.infer<typeof purchaseOrderLineSchema>;
export type PurchaseOrderSummary = z.infer<typeof purchaseOrderSummarySchema>;
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;
export type PurchaseOrderLineInput = z.input<typeof purchaseOrderLineInputSchema>;
export type CreatePurchaseOrderInput = z.input<typeof createPurchaseOrderInputSchema>;
export type UpdatePurchaseOrderInput = z.input<typeof updatePurchaseOrderInputSchema>;
export type PurchaseOrderIdInput = z.input<typeof purchaseOrderIdInputSchema>;
export type GetPurchaseOrderResult = z.infer<typeof getPurchaseOrderResultSchema>;
export type CreatePurchaseOrderResult = z.infer<typeof createPurchaseOrderResultSchema>;
export type UpdatePurchaseOrderResult = z.infer<typeof updatePurchaseOrderResultSchema>;
export type ConfirmPurchaseOrderResult = z.infer<typeof confirmPurchaseOrderResultSchema>;
export type CancelPurchaseOrderResult = z.infer<typeof cancelPurchaseOrderResultSchema>;
