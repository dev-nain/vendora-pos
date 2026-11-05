import { z } from "zod";
import { refusal } from "./checkout";
import { formatRupees } from "./money";
import { productUnits, type ProductUnit } from "./products";
import { formatQuantity } from "./quantity";

export function refundCapPaisa(input: {
  availablePaisa: number;
  linkedRefundPaisa: number;
  netRefundPaisa: number;
}): number {
  return Math.max(0, Math.min(input.availablePaisa, input.linkedRefundPaisa, input.netRefundPaisa));
}

export const returnMessages = {
  oneSale: "You can only return items from one sale per bill.",
  linkedLocked: "This line comes from a receipt. Change its quantity or delete it.",
  notReturnable: "Return lines can't be returned again.",
  noStock: "Misc items have no stock.",
  notReturn: "Only return lines go to damaged stock.",
  overSold: (leftMilli: number, unit: ProductUnit): string =>
    `Only ${unit === "piece" ? String(Math.floor(leftMilli / 1000)) : formatQuantity(leftMilli, unit)} left to return.`,
  overCap: (methodLabel: string, paisa: number): string =>
    `${methodLabel} can refund up to ${formatRupees(paisa)}.`,
  refundExact: (paisa: number): string => `Refund exactly ${formatRupees(paisa)}.`,
} as const;

export const returnableInputSchema = z.strictObject({ saleId: z.uuid() });

export const addFromSaleInputSchema = z.strictObject({
  saleId: z.uuid(),
  lines: z
    .array(
      z.strictObject({
        saleLineId: z.uuid(),
        qtyMilli: z.int().min(1).max(1_000_000_000),
      }),
    )
    .min(1)
    .max(200)
    .refine((lines) => new Set(lines.map((line) => line.saleLineId)).size === lines.length, {
      message: "Each line can be listed once",
    }),
});

export const returnableLineSchema = z.strictObject({
  saleLineId: z.string(),
  nameEn: z.string(),
  nameUr: z.string().nullable(),
  unit: z.enum(productUnits),
  packQtyMilli: z.int(),
  unitPricePaisa: z.int(),
  isMisc: z.boolean(),
  soldQtyMilli: z.int(),
  refundedQtyMilli: z.int(),
  pendingQtyMilli: z.int(),
  leftQtyMilli: z.int(),
});

export const returnableResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    sale: z.strictObject({
      id: z.string(),
      invoiceNo: z.string(),
      createdAt: z.iso.datetime(),
      cashierName: z.string(),
      type: z.enum(["sale", "refund"]),
    }),
    hasReturnLines: z.boolean(),
    lines: z.array(returnableLineSchema),
  }),
  refusal("not-found"),
]);

export type AddFromSaleInput = z.input<typeof addFromSaleInputSchema>;
export type ReturnableResult = z.infer<typeof returnableResultSchema>;
export type ReturnableLine = Extract<ReturnableResult, { ok: true }>["lines"][number];
