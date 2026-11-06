import { z } from "zod";
import { productUnits } from "./products";

export const paymentMethods = ["cash", "card", "bank_transfer", "jazzcash", "easypaisa"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank transfer",
  jazzcash: "JazzCash",
  easypaisa: "Easypaisa",
};

export const checkoutMessages = {
  noOpenShift: "Open a shift first.",
  notFound: "That bill or line no longer exists. Refresh.",
  productNotFound: "No product has that barcode.",
  wholeUnits: "Pieces and packs sell in whole units.",
  scaleLine: "Scan the label again to change a weighed line.",
  returnDiscount: "Returns take no discount.",
  noPrice: "This item has no price. Set a price first.",
  miscDisabled: "Misc item is switched off in Settings.",
  emptyBill: "Add an item first.",
  underpaid: "Payment is short.",
  cashNotRounded: "Cash is taken in the rounding unit. Adjust the cash amount.",
  refundCashOnly: "Refunds without a receipt are paid in cash.",
  needsWeight: "Enter the weight.",
} as const;

const maxPaisa = 100_000_000_00;
export const maxQtyMilli = 1_000_000_000;

export const refusal = <Reason extends string>(reason: Reason) =>
  z.strictObject({ ok: z.literal(false), reason: z.literal(reason), message: z.string() });

const paisaSchema = z.int().min(0).max(maxPaisa);
const positivePaisaSchema = z.int().min(1).max(maxPaisa);
const qtyMilliSchema = z.int().min(1).max(maxQtyMilli);
const isoSchema = z.iso.datetime();

export const discountSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("amount"), amountPaisa: paisaSchema }),
  z.strictObject({ kind: z.literal("percent"), bps: z.int().min(0).max(10000) }),
]);

export const scanInputSchema = z.strictObject({
  barcode: z.string().trim().min(1).max(64),
  isReturn: z.boolean().optional(),
});

export const addProductInputSchema = z.strictObject({
  productId: z.uuid(),
  qtyMilli: qtyMilliSchema.optional(),
  isReturn: z.boolean().optional(),
});

export const addMiscInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  pricePaisa: positivePaisaSchema,
  isReturn: z.boolean().optional(),
});

export const updateLineInputSchema = z
  .strictObject({
    lineId: z.uuid(),
    qtyMilli: qtyMilliSchema.optional(),
    unitPricePaisa: paisaSchema.optional(),
    discount: discountSchema.nullable().optional(),
  })
  .refine(
    (input) =>
      input.qtyMilli !== undefined ||
      input.unitPricePaisa !== undefined ||
      input.discount !== undefined,
    { message: "Nothing to change" },
  );

export const setDamagedInputSchema = z.strictObject({
  lineId: z.uuid(),
  damaged: z.boolean(),
});

export const lineIdInputSchema = z.strictObject({ lineId: z.uuid() });
export const draftIdInputSchema = z.strictObject({ draftId: z.uuid() });

export const setBillDiscountInputSchema = z.strictObject({
  draftId: z.uuid(),
  discount: discountSchema.nullable(),
});

export const holdInputSchema = z.strictObject({
  draftId: z.uuid(),
});

export const ntnSchema = z
  .string()
  .trim()
  .regex(/^\d{7}-?\d$/, "NTN is 7 digits, then 1 digit, like 1234567-8.")
  .transform((value) => `${value.slice(0, 7)}-${value.slice(-1)}`);

export const buyerSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, "Name is up to 100 characters.")
    .max(100, "Name is up to 100 characters.")
    .optional(),
  ntn: ntnSchema.optional(),
  cnic: z
    .string()
    .trim()
    .regex(/^\d{5}-?\d{7}-?\d$/, "CNIC is 13 digits, like 12345-1234567-1.")
    .transform((value) => {
      const digits = value.replaceAll("-", "");
      return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
    })
    .optional(),
  phone: z
    .string()
    .trim()
    .regex(/^(03\d{9}|\+923\d{9})$/, "Phone is 03xxxxxxxxx or +923xxxxxxxxx.")
    .optional(),
});

export type BuyerInput = z.input<typeof buyerSchema>;

export const completeSaleInputSchema = z.strictObject({
  draftId: z.uuid(),
  payments: z
    .array(
      z
        .strictObject({
          method: z.enum(paymentMethods),
          amountPaisa: positivePaisaSchema,
          reference: z.string().trim().min(1).max(64).optional(),
        })
        .refine((payment) => payment.method !== "cash" || payment.reference === undefined, {
          message: "Cash has no reference",
          path: ["reference"],
        }),
    )
    .max(10),
  buyer: buyerSchema.optional(),
});

export const billLineSchema = z.strictObject({
  id: z.string(),
  position: z.int(),
  productId: z.string(),
  name: z.string(),
  nameUr: z.string().nullable(),
  unit: z.enum(productUnits),
  qtyMilli: z.int(),
  packQtyMilli: z.int(),
  unitPricePaisa: z.int(),
  priceType: z.enum(["original", "manual"]),
  discount: discountSchema.nullable(),
  isReturn: z.boolean(),
  isDamaged: z.boolean(),
  refundedLineId: z.string().nullable(),
  scaleSource: z.enum(["weight", "price"]).nullable(),
  isMisc: z.boolean(),
  grossPaisa: z.int(),
  lineDiscountPaisa: z.int(),
  billDiscountPaisa: z.int(),
  taxRateBps: z.int(),
  taxPaisa: z.int(),
  totalPaisa: z.int(),
});

export const billTotalsSchema = z.strictObject({
  subtotalPaisa: z.int(),
  discountPaisa: z.int(),
  taxPaisa: z.int(),
  roundingPaisa: z.int(),
  totalPaisa: z.int(),
});

export const billRefundSchema = z.strictObject({
  saleId: z.string(),
  invoiceNo: z.string(),
  linkedRefundPaisa: z.int(),
  methods: z.array(
    z.strictObject({ method: z.enum(paymentMethods), availablePaisa: z.int().min(0) }),
  ),
});

export const billSchema = z.strictObject({
  id: z.string(),
  heldAt: isoSchema.nullable(),
  billDiscount: discountSchema.nullable(),
  lines: z.array(billLineSchema),
  deletedLineCount: z.int(),
  refund: billRefundSchema.nullable(),
  totals: billTotalsSchema,
  pricesIncludeTax: z.boolean(),
  cashRounding: z.strictObject({
    mode: z.enum(["off", "every-bill", "cash-only"]),
    unitPaisa: z.int(),
  }),
});

const needsWeightSchema = z.strictObject({
  ok: z.literal(false),
  reason: z.literal("needs-weight"),
  message: z.string(),
  product: z.strictObject({
    id: z.string(),
    name: z.string(),
    nameUr: z.string().nullable(),
    unit: z.enum(productUnits),
    unitPricePaisa: z.int(),
  }),
});

const noOpenShiftSchema = refusal("no-open-shift");
const notFoundSchema = refusal("not-found");
const emptyBillSchema = refusal("empty-bill");

export const billResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), bill: billSchema }),
  noOpenShiftSchema,
  notFoundSchema,
  refusal("product-not-found"),
  refusal("whole-units"),
  refusal("scale-line"),
  refusal("return-discount"),
  refusal("no-price"),
  refusal("misc-disabled"),
  refusal("one-sale"),
  refusal("not-returnable"),
  refusal("return-over-sold"),
  refusal("linked-return"),
  refusal("not-return"),
  refusal("no-stock"),
  needsWeightSchema,
  emptyBillSchema,
]);

export const currentBillSchema = z.strictObject({ bill: billSchema.nullable() });

export const actionResultSchema = z.union([
  z.strictObject({ ok: z.literal(true) }),
  noOpenShiftSchema,
  notFoundSchema,
  emptyBillSchema,
]);

export const completeSaleResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    sale: z.strictObject({
      id: z.string(),
      invoiceNo: z.string(),
      type: z.enum(["sale", "refund"]),
      totalPaisa: z.int(),
      roundingPaisa: z.int(),
      changePaisa: z.int(),
      createdAt: isoSchema,
      replayed: z.boolean(),
    }),
  }),
  noOpenShiftSchema,
  notFoundSchema,
  emptyBillSchema,
  z.strictObject({
    ok: z.literal(false),
    reason: z.literal("underpaid"),
    message: z.string(),
    duePaisa: z.int(),
  }),
  refusal("cash-not-rounded"),
  refusal("refund-cash-only"),
  refusal("refund-amount"),
  refusal("refund-over-cap"),
  refusal("one-sale"),
  refusal("not-returnable"),
  refusal("return-over-sold"),
]);

export type Discount = z.infer<typeof discountSchema>;
export type ScanInput = z.input<typeof scanInputSchema>;
export type AddProductInput = z.input<typeof addProductInputSchema>;
export type AddMiscInput = z.input<typeof addMiscInputSchema>;
export type UpdateLineInput = z.input<typeof updateLineInputSchema>;
export type SetDamagedInput = z.input<typeof setDamagedInputSchema>;
export type SetBillDiscountInput = z.input<typeof setBillDiscountInputSchema>;
export type HoldInput = z.input<typeof holdInputSchema>;
export type CompleteSaleInput = z.input<typeof completeSaleInputSchema>;
export type BillLine = z.infer<typeof billLineSchema>;
export type Bill = z.infer<typeof billSchema>;
export type BillResult = z.infer<typeof billResultSchema>;
export type CurrentBill = z.infer<typeof currentBillSchema>;
export type ActionResult = z.infer<typeof actionResultSchema>;
export type CompleteSaleResult = z.infer<typeof completeSaleResultSchema>;
export type CompletedSale = Extract<CompleteSaleResult, { ok: true }>["sale"];
