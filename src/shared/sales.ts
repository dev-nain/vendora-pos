import { z } from "zod";
import { paymentMethods, refusal } from "./checkout";
import { productUnits } from "./products";

export const salesMessages = {
  notFound: "That sale no longer exists. Refresh.",
} as const;

export const ordersListLimit = 200;

export const salesListQuerySchema = z.union([
  z.strictObject({ scope: z.literal("shift") }),
  z.strictObject({ invoiceNo: z.string().trim().min(1).max(32) }),
  z.strictObject({ date: z.iso.date() }),
]);

export const orderSummarySchema = z.strictObject({
  id: z.string(),
  invoiceNo: z.string(),
  createdAt: z.iso.datetime(),
  cashierName: z.string(),
  totalPaisa: z.int(),
  type: z.enum(["sale", "refund"]),
  methods: z.array(z.enum(paymentMethods)),
});

export const orderListSchema = z.array(orderSummarySchema).max(ordersListLimit);

export const orderIdInputSchema = z.strictObject({ id: z.uuid() });

export const orderDetailSchema = z.strictObject({
  id: z.string(),
  invoiceNo: z.string(),
  type: z.enum(["sale", "refund"]),
  createdAt: z.iso.datetime(),
  cashierName: z.string(),
  refundedInvoiceNo: z.string().nullable(),
  lines: z.array(
    z.strictObject({
      nameEn: z.string(),
      nameUr: z.string().nullable(),
      unit: z.enum(productUnits),
      qtyMilli: z.int(),
      packQtyMilli: z.int(),
      isReturn: z.boolean(),
      unitPricePaisa: z.int(),
      discountPaisa: z.int(),
      totalPaisa: z.int(),
    }),
  ),
  subtotalPaisa: z.int(),
  discountPaisa: z.int(),
  taxPaisa: z.int(),
  roundingPaisa: z.int(),
  totalPaisa: z.int(),
  changePaisa: z.int(),
  payments: z.array(
    z.strictObject({
      method: z.enum(paymentMethods),
      amountPaisa: z.int(),
      reference: z.string().nullable(),
    }),
  ),
  buyerName: z.string().nullable(),
  buyerNtn: z.string().nullable(),
  printCount: z.int(),
});

export const getOrderResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), sale: orderDetailSchema }),
  refusal("not-found"),
]);

export type SalesListQuery = z.infer<typeof salesListQuerySchema>;
export type OrderSummary = z.infer<typeof orderSummarySchema>;
export type OrderDetail = z.infer<typeof orderDetailSchema>;
export type GetOrderResult = z.infer<typeof getOrderResultSchema>;
