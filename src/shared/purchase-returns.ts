import { z } from "zod";
import { isoSchema, qtyMilliSchema, refusal } from "./checkout";
import { goodsReceivedMessages } from "./goods-received";
import { productUnits } from "./products";
import { purchaseOrderMessages } from "./purchase-orders";
import { textField } from "./settings";

export const purchaseReturnReasons = ["damaged", "expired", "wrong_item", "over_supplied"] as const;
export type PurchaseReturnReason = (typeof purchaseReturnReasons)[number];

export const purchaseReturnReasonLabels: Record<PurchaseReturnReason, string> = {
  damaged: "Damaged",
  expired: "Expired",
  wrong_item: "Wrong item",
  over_supplied: "Over-supplied",
};

export const purchaseReturnMessages = {
  notFound: "That purchase return no longer exists.",
  noteNotFound: goodsReceivedMessages.notFound,
  supplierUnavailable: goodsReceivedMessages.supplierUnavailable,
  productUnavailable: goodsReceivedMessages.productUnavailable,
  notReceived: "That product was never received from this supplier.",
  lineUnavailable: "One of the lines is not on this goods received note. Refresh the note.",
  overReturnable: "That's more than is left to return. Refresh and check the quantities.",
  pdfFailed: purchaseOrderMessages.pdfFailed,
  printFailed: purchaseOrderMessages.printFailed,
} as const;

const reasonSchema = z.enum(purchaseReturnReasons);
const notesSchema = textField(500, "Notes are up to 500 characters.");
const linesError = "Add at least one line.";

function refuseRepeats(key: string) {
  return (input: { lines: Record<string, unknown>[] }, ctx: z.RefinementCtx) => {
    const seen = new Set<unknown>();
    for (const [index, line] of input.lines.entries()) {
      if (seen.has(line[key])) {
        ctx.addIssue({
          code: "custom",
          path: ["lines", index, key],
          message: "Each product goes on one line.",
        });
      }
      seen.add(line[key]);
    }
  };
}

export const postPurchaseReturnInputSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("supplier"),
      supplierId: z.uuid(),
      reason: reasonSchema,
      notes: notesSchema,
      lines: z
        .array(z.strictObject({ productId: z.uuid(), qtyMilli: qtyMilliSchema }))
        .min(1, linesError)
        .max(1000),
    })
    .superRefine(refuseRepeats("productId")),
  z
    .strictObject({
      kind: z.literal("note"),
      goodsReceivedNoteId: z.uuid(),
      reason: reasonSchema,
      notes: notesSchema,
      lines: z
        .array(z.strictObject({ goodsReceivedLineId: z.uuid(), qtyMilli: qtyMilliSchema }))
        .min(1, linesError)
        .max(1000),
    })
    .superRefine(refuseRepeats("goodsReceivedLineId")),
]);

export const purchaseReturnIdInputSchema = z.strictObject({ id: z.uuid() });
export const purchaseReturnableInputSchema = z.strictObject({
  supplierId: z.uuid(),
  productId: z.uuid(),
});

export const PURCHASE_RETURNS_MAX_LIMIT = 100;

export const purchaseReturnListQuerySchema = z.strictObject({
  limit: z.int().min(1).max(PURCHASE_RETURNS_MAX_LIMIT),
  offset: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export const purchaseReturnLineSchema = z.strictObject({
  id: z.string(),
  productId: z.string(),
  goodsReceivedLineId: z.string().nullable(),
  nameEn: z.string(),
  nameUr: z.string().nullable(),
  unit: z.enum(productUnits),
  qtyMilli: z.int(),
  unitCostPaisa: z.int(),
  lineTotalPaisa: z.int(),
});

export const purchaseReturnSchema = z.strictObject({
  id: z.string(),
  returnNo: z.string(),
  supplierId: z.string(),
  supplierName: z.string(),
  goodsReceivedNoteId: z.string().nullable(),
  grnNo: z.string().nullable(),
  supplierInvoiceNo: z.string().nullable(),
  reason: reasonSchema,
  notes: z.string().nullable(),
  totalPaisa: z.int(),
  actorName: z.string(),
  createdAt: isoSchema,
  lines: z.array(purchaseReturnLineSchema),
});

export const postPurchaseReturnResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), purchaseReturn: purchaseReturnSchema }),
  refusal("supplier-unavailable"),
  refusal("product-unavailable"),
  refusal("whole-units"),
  refusal("not-received"),
  refusal("note-not-found"),
  refusal("line-unavailable"),
  refusal("over-returnable"),
]);

export const purchaseReturnSummarySchema = z.strictObject({
  id: z.string(),
  returnNo: z.string(),
  supplierId: z.string(),
  supplierName: z.string(),
  grnNo: z.string().nullable(),
  reason: reasonSchema,
  lineCount: z.int(),
  totalPaisa: z.int(),
  createdAt: isoSchema,
});

export const purchaseReturnListResultSchema = z.strictObject({
  items: z.array(purchaseReturnSummarySchema),
  total: z.int(),
});

export const getPurchaseReturnResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), purchaseReturn: purchaseReturnSchema }),
  refusal("not-found"),
]);

export const purchaseReturnableResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    product: z.strictObject({
      id: z.string(),
      nameEn: z.string(),
      nameUr: z.string().nullable(),
      unit: z.enum(productUnits),
    }),
    unitCostPaisa: z.int(),
    returnableQtyMilli: z.int(),
  }),
  refusal("not-received"),
  refusal("supplier-unavailable"),
  refusal("product-unavailable"),
]);

export const purchaseReturnableNoteResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    note: z.strictObject({
      id: z.string(),
      grnNo: z.string(),
      supplierId: z.string(),
      supplierName: z.string(),
      supplierInvoiceNo: z.string(),
      createdAt: isoSchema,
    }),
    lines: z.array(
      z.strictObject({
        goodsReceivedLineId: z.string(),
        productId: z.string(),
        nameEn: z.string(),
        nameUr: z.string().nullable(),
        unit: z.enum(productUnits),
        receivedQtyMilli: z.int(),
        unitCostPaisa: z.int(),
        returnableQtyMilli: z.int(),
      }),
    ),
  }),
  refusal("not-found"),
]);

export const savePurchaseReturnPdfResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), status: z.literal("saved"), path: z.string() }),
  z.strictObject({ ok: z.literal(true), status: z.literal("cancelled") }),
  refusal("not-found"),
  refusal("failed"),
]);

export const printPurchaseReturnResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), status: z.enum(["printed", "cancelled"]) }),
  refusal("not-found"),
  refusal("failed"),
]);

export type PurchaseReturnLine = z.infer<typeof purchaseReturnLineSchema>;
export type PurchaseReturn = z.infer<typeof purchaseReturnSchema>;
export type PostPurchaseReturnInput = z.input<typeof postPurchaseReturnInputSchema>;
export type PostPurchaseReturnResult = z.infer<typeof postPurchaseReturnResultSchema>;
export type PurchaseReturnSummary = z.infer<typeof purchaseReturnSummarySchema>;
export type PurchaseReturnListQuery = z.input<typeof purchaseReturnListQuerySchema>;
export type PurchaseReturnListResult = z.infer<typeof purchaseReturnListResultSchema>;
export type GetPurchaseReturnResult = z.infer<typeof getPurchaseReturnResultSchema>;
export type PurchaseReturnableInput = z.input<typeof purchaseReturnableInputSchema>;
export type PurchaseReturnableResult = z.infer<typeof purchaseReturnableResultSchema>;
export type PurchaseReturnableNoteResult = z.infer<typeof purchaseReturnableNoteResultSchema>;
export type PurchaseReturnableNote = Extract<PurchaseReturnableNoteResult, { ok: true }>;
export type SavePurchaseReturnPdfResult = z.infer<typeof savePurchaseReturnPdfResultSchema>;
export type PrintPurchaseReturnResult = z.infer<typeof printPurchaseReturnResultSchema>;
