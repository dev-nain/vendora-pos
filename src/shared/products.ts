import { z } from "zod";

export const productUnits = ["piece", "kg", "litre"] as const;
export type ProductUnit = (typeof productUnits)[number];

export const productMessages = {
  notFound: "That product no longer exists. Refresh the list.",
  systemProduct: "Misc item is built in and can't be edited, archived or deleted.",
  categoryNotFound: "That category no longer exists. Pick another.",
  taxCategoryNotFound: "That tax category no longer exists. Pick another.",
  barcodeTaken: (barcode: string, productName: string) =>
    `Barcode ${barcode} already belongs to "${productName}".`,
  internalCodeTaken: (code: string, productName: string) =>
    `Internal code ${code} already belongs to "${productName}".`,
  mrpBelowSalePrice: "MRP can't be less than the sale price",
  duplicateBarcode: "This barcode is already in the list",
  ineligibleProducts:
    "Some selected products no longer exist or can't be edited. Refresh the list.",
  aboveMrp: (count: number) =>
    `${count} ${count === 1 ? "product would" : "products would"} cost more than ${count === 1 ? "its" : "their"} MRP. Nothing was changed.`,
  bulkPercentRange: "Enter a percentage above -100 and up to 1000, other than 0",
} as const;

export const BULK_UPDATE_MAX_IDS = 5000;
const BULK_MAX_BPS = 100000;

const paisaSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const productUnitSchema = z.enum(productUnits);

export function adjustPricePaisa(pricePaisa: number, bps: number): number {
  const scaled = BigInt(pricePaisa) * BigInt(10000 + bps);
  const rupees = (scaled + 500000n) / 1000000n;
  const next = rupees * 100n;
  if (next > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Adjusted price is too large");
  return Number(next);
}

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

export function priceUpdateInput(product: Product, salePricePaisa: number): UpdateProductInput {
  return {
    id: product.id,
    nameEn: product.nameEn,
    nameUr: product.nameUr,
    categoryId: product.categoryId,
    taxCategoryId: product.taxCategoryId,
    brand: product.brand,
    unit: product.unit,
    internalCode: product.internalCode,
    costPaisa: product.costPaisa,
    salePricePaisa,
    mrpPaisa: product.mrpPaisa,
    pctCode: product.pctCode,
    lowStockThresholdMilli: product.lowStockThresholdMilli,
    barcodes: product.barcodes.map((entry) => ({
      barcode: entry.barcode,
      packQtyMilli: entry.packQtyMilli,
      salePricePaisa: entry.salePricePaisa,
    })),
  };
}

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

export const PRODUCT_SEARCH_MAX_LIMIT = 100;

export const productSearchInputSchema = z.strictObject({
  query: z.string().max(200),
  categoryId: z.uuid().optional(),
  includeArchived: z.boolean().optional(),
  limit: z.int().min(1).max(PRODUCT_SEARCH_MAX_LIMIT),
  offset: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export const productSearchItemSchema = z.strictObject({
  id: z.string(),
  nameEn: z.string(),
  nameUr: z.string().nullable(),
  internalCode: z.string().nullable(),
  categoryId: z.string(),
  unit: productUnitSchema,
  salePricePaisa: z.number(),
  isActive: z.boolean(),
  primaryBarcode: z.string().nullable(),
  extraBarcodeCount: z.int().nonnegative(),
  onHandMilli: z.int(),
});

export const productSearchResultSchema = z.strictObject({
  items: z.array(productSearchItemSchema),
  total: z.number(),
});

export const barcodeLookupInputSchema = z.strictObject({
  barcode: z.string().trim().min(1).max(64),
});

export const scaleBarcodeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ itemCode: z.string(), kind: z.literal("weight"), qtyMilli: z.number() }),
  z.strictObject({ itemCode: z.string(), kind: z.literal("price"), pricePaisa: z.number() }),
]);

export const barcodeLookupProductSchema = z.strictObject({
  id: z.string(),
  nameEn: z.string(),
  nameUr: z.string().nullable(),
  unit: productUnitSchema,
  salePricePaisa: z.number(),
  taxCategoryId: z.string(),
  costPaisa: z.number(),
});

export const barcodeLookupSchema = z.discriminatedUnion("source", [
  z.strictObject({
    source: z.literal("barcode"),
    product: barcodeLookupProductSchema,
    packQtyMilli: z.number(),
    packPricePaisa: z.number().nullable(),
  }),
  z.strictObject({
    source: z.literal("scale"),
    product: barcodeLookupProductSchema,
    scale: scaleBarcodeSchema,
  }),
]);

const unique = (ids: string[]) => [...new Set(ids)];

export const bulkProductChangeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("category"), categoryId: z.uuid() }),
  z.strictObject({ kind: z.literal("set-price"), salePricePaisa: paisaSchema }),
  z.strictObject({
    kind: z.literal("adjust-price"),
    bps: z
      .int(productMessages.bulkPercentRange)
      .gt(-10000, productMessages.bulkPercentRange)
      .max(BULK_MAX_BPS, productMessages.bulkPercentRange)
      .refine((bps) => bps !== 0, productMessages.bulkPercentRange),
  }),
]);

export const bulkUpdateProductsInputSchema = z.strictObject({
  productIds: z.array(z.uuid()).min(1).max(BULK_UPDATE_MAX_IDS).transform(unique),
  change: bulkProductChangeSchema,
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
  refusal("system-product"),
  ...createRefusals,
]);

export const getProductResultSchema = z.union([okResult, refusal("not-found")]);

export const productStatusResultSchema = z.union([
  okResult,
  refusal("not-found"),
  refusal("system-product"),
]);

export const deleteProductResultSchema = z.union([
  z.strictObject({ ok: z.literal(true) }),
  refusal("not-found"),
  refusal("system-product"),
]);

export const bulkUpdateProductsResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    changed: z.int().nonnegative(),
    unchanged: z.int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.literal("ineligible-products"),
    message: z.string(),
    productIds: z.array(z.string()),
  }),
  refusal("category-not-found"),
  z.strictObject({
    ok: z.literal(false),
    reason: z.literal("above-mrp"),
    message: z.string(),
    products: z.array(
      z.strictObject({
        id: z.string(),
        nameEn: z.string(),
        salePricePaisa: z.number(),
        mrpPaisa: z.number(),
      }),
    ),
  }),
]);

export type ProductIdInput = z.infer<typeof productIdInputSchema>;
export type ProductStatusResult = z.infer<typeof productStatusResultSchema>;
export type DeleteProductResult = z.infer<typeof deleteProductResultSchema>;
export type CreateProductInput = z.input<typeof createProductInputSchema>;
export type UpdateProductInput = z.input<typeof updateProductInputSchema>;
export type Product = z.infer<typeof productSchema>;
export type CreateProductResult = z.infer<typeof createProductResultSchema>;
export type UpdateProductResult = z.infer<typeof updateProductResultSchema>;
export type ProductSearchQuery = z.input<typeof productSearchInputSchema>;
export type ProductSearchInput = z.output<typeof productSearchInputSchema>;
export type ProductSearchItem = z.infer<typeof productSearchItemSchema>;
export type ProductSearchResult = z.infer<typeof productSearchResultSchema>;
export type BarcodeLookupInput = z.infer<typeof barcodeLookupInputSchema>;
export type ScaleBarcode = z.infer<typeof scaleBarcodeSchema>;
export type BarcodeLookupProduct = z.infer<typeof barcodeLookupProductSchema>;
export type BarcodeLookup = z.infer<typeof barcodeLookupSchema>;
export type GetProductResult = z.infer<typeof getProductResultSchema>;
export type BulkProductChange = z.infer<typeof bulkProductChangeSchema>;
export type BulkUpdateProductsInput = z.input<typeof bulkUpdateProductsInputSchema>;
export type BulkUpdateProductsResult = z.infer<typeof bulkUpdateProductsResultSchema>;

export const catalogExportResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("saved"), path: z.string().min(1) }),
  z.strictObject({ status: z.literal("cancelled") }),
]);
export type CatalogExportResult = z.infer<typeof catalogExportResultSchema>;
