import { z } from "zod";
import { productUnits } from "./products";

export const reportDetailLimit = 200;

const count = z.number().int();
const iso = z.iso.datetime();

export const returnSummaryKinds = [
  "with-receipt",
  "without-receipt",
  "back-to-shelf",
  "damaged",
] as const;
export type ReturnSummaryKind = (typeof returnSummaryKinds)[number];

export const returnDispositions = ["back-to-shelf", "damaged", "no-stock"] as const;
export type ReturnDisposition = (typeof returnDispositions)[number];

export const voidBillStates = ["sold", "discarded", "not-completed"] as const;
export type VoidBillState = (typeof voidBillStates)[number];

const discountByUserSchema = z.strictObject({
  userId: z.string(),
  userName: z.string(),
  billCount: count,
  discountPaisa: count,
});

const discountBillSchema = z.strictObject({
  saleId: z.string(),
  invoiceNo: z.string(),
  createdAt: iso,
  userName: z.string(),
  totalPaisa: count,
  discountPaisa: count,
});

const returnSummarySchema = z.strictObject({
  kind: z.enum(returnSummaryKinds),
  label: z.string(),
  lineCount: count,
  valuePaisa: count,
});

const returnLineSchema = z.strictObject({
  lineId: z.string(),
  saleId: z.string(),
  invoiceNo: z.string(),
  createdAt: iso,
  userName: z.string(),
  itemName: z.string(),
  unit: z.enum(productUnits),
  qtyMilli: count,
  receiptInvoiceNo: z.string().nullable(),
  disposition: z.enum(returnDispositions),
  valuePaisa: count,
});

const deletedLineSchema = z.strictObject({
  auditId: z.string(),
  createdAt: iso,
  userName: z.string(),
  itemName: z.string(),
  unit: z.enum(productUnits),
  qtyMilli: count,
  billState: z.enum(voidBillStates),
  invoiceNo: z.string().nullable(),
  grossPaisa: count,
});

const discardedBillSchema = z.strictObject({
  auditId: z.string(),
  createdAt: iso,
  userName: z.string(),
  lineCount: count,
  totalPaisa: count,
});

export const discountsReturnsVoidsResultSchema = z.strictObject({
  discounts: z.strictObject({
    byUser: z.array(discountByUserSchema),
    bills: z.array(discountBillSchema),
    billCount: count,
    discountPaisa: count,
  }),
  returns: z.strictObject({
    summary: z.array(returnSummarySchema),
    lines: z.array(returnLineSchema),
    lineCount: count,
    valuePaisa: count,
  }),
  voids: z.strictObject({
    deletedLines: z.strictObject({
      rows: z.array(deletedLineSchema),
      count,
      grossPaisa: count,
    }),
    discardedBills: z.strictObject({
      rows: z.array(discardedBillSchema),
      count,
      totalPaisa: count,
    }),
  }),
});
export type DiscountsReturnsVoidsResult = z.infer<typeof discountsReturnsVoidsResultSchema>;
export type DiscountBillRow = DiscountsReturnsVoidsResult["discounts"]["bills"][number];
export type DiscountByUserRow = DiscountsReturnsVoidsResult["discounts"]["byUser"][number];
export type ReturnSummaryRow = DiscountsReturnsVoidsResult["returns"]["summary"][number];
export type ReturnLineRow = DiscountsReturnsVoidsResult["returns"]["lines"][number];
export type DeletedLineRow = DiscountsReturnsVoidsResult["voids"]["deletedLines"]["rows"][number];
export type DiscardedBillRow =
  DiscountsReturnsVoidsResult["voids"]["discardedBills"]["rows"][number];
