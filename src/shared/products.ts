import { z } from "zod";

export const productUnits = ["piece", "kg", "litre"] as const;
export type ProductUnit = (typeof productUnits)[number];

export const productMessages = {
  notFound: "That product no longer exists. Refresh the list.",
  categoryNotFound: "That category no longer exists. Pick another.",
  taxCategoryNotFound: "That tax category no longer exists. Pick another.",
  barcodeTaken: (barcode: string, productName: string) =>
    `Barcode ${barcode} already belongs to "${productName}".`,
  internalCodeTaken: (code: string, productName: string) =>
    `Internal code ${code} already belongs to "${productName}".`,
  mrpBelowSalePrice: "MRP can't be less than the sale price",
  duplicateBarcode: "This barcode is already in the list",
  systemProduct: "This is a built-in item and can't be archived or deleted.",
} as const;

const paisaSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const productUnitSchema = z.enum(productUnits);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === "" ? null : value));

export const productBarcodeInputSchema = z.strictObject({
  barcode: z.string().trim().min(1).max(64).regex(/^\S+$/, "Barcode can't contain spaces"),
  packQtyMilli: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(1000),
  salePricePaisa: paisaSchema.nullable().default(null),
});

const productFieldsSchema = z.strictObject({
  nameEn: z.string().trim().min(1).max(120),
  nameUr: optionalText(120),
  categoryId: z.uuid(),
  taxCategoryId: z.uuid(),
  brand: optionalText(64),
  unit: productUnitSchema,
  internalCode: optionalText(32),
  costPaisa: paisaSchema,
  salePricePaisa: paisaSchema,
  mrpPaisa: paisaSchema.nullable(),
  pctCode: optionalText(16),
  lowStockThresholdMilli: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  barcodes: z.array(productBarcodeInputSchema).max(50),
});

function checkCrossFields(value: z.output<typeof productFieldsSchema>, ctx: z.RefinementCtx): void {
  if (value.mrpPaisa !== null && value.mrpPaisa < value.salePricePaisa) {
    ctx.addIssue({
      code: "custom",
      path: ["mrpPaisa"],
      message: productMessages.mrpBelowSalePrice,
    });
  }
  const seen = new Set<string>();
  for (const [index, entry] of value.barcodes.entries()) {
    if (seen.has(entry.barcode)) {
      ctx.addIssue({
        code: "custom",
        path: ["barcodes", index, "barcode"],
        message: productMessages.duplicateBarcode,
      });
    }
    seen.add(entry.barcode);
  }
}

export const createProductInputSchema = productFieldsSchema.superRefine(checkCrossFields);

export const updateProductInputSchema = productFieldsSchema
  .extend({ id: z.uuid() })
  .superRefine(checkCrossFields);

export const productIdInputSchema = z.strictObject({ id: z.uuid() });

export const productSchema = z.strictObject({
  id: z.string(),
  nameEn: z.string(),
  nameUr: z.string().nullable(),
  categoryId: z.string(),
  taxCategoryId: z.string(),
  brand: z.string().nullable(),
  unit: productUnitSchema,
  internalCode: z.string().nullable(),
  costPaisa: z.number(),
  salePricePaisa: z.number(),
  mrpPaisa: z.number().nullable(),
  pctCode: z.string().nullable(),
  lowStockThresholdMilli: z.number().nullable(),
  isActive: z.boolean(),
  barcodes: z.array(
    z.strictObject({
      barcode: z.string(),
      packQtyMilli: z.number(),
      salePricePaisa: z.number().nullable(),
    }),
  ),
});

const refusal = <Reason extends string>(reason: Reason) =>
  z.strictObject({ ok: z.literal(false), reason: z.literal(reason), message: z.string() });

const okResult = z.strictObject({ ok: z.literal(true), product: productSchema });

const createRefusals = [
  refusal("category-not-found"),
  refusal("tax-category-not-found"),
  refusal("barcode-taken"),
  refusal("internal-code-taken"),
] as const;

export const createProductResultSchema = z.union([okResult, ...createRefusals]);
export const updateProductResultSchema = z.union([
  okResult,
  refusal("not-found"),
  ...createRefusals,
]);

export const productStatusResultSchema = z.union([
  okResult,
  refusal("not-found"),
  refusal("system-product"),
]);

export type ProductIdInput = z.infer<typeof productIdInputSchema>;
export type ProductStatusResult = z.infer<typeof productStatusResultSchema>;
export type CreateProductInput = z.input<typeof createProductInputSchema>;
export type UpdateProductInput = z.input<typeof updateProductInputSchema>;
export type Product = z.infer<typeof productSchema>;
export type CreateProductResult = z.infer<typeof createProductResultSchema>;
export type UpdateProductResult = z.infer<typeof updateProductResultSchema>;
