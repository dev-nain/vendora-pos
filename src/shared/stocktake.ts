import { z } from "zod";
import { maxQtyMilli, refusal } from "./checkout";
import { barcodeLookupInputSchema, PRODUCT_SEARCH_MAX_LIMIT, productUnits } from "./products";

export const stocktakeScopes = ["full", "category"] as const;
export type StocktakeScope = (typeof stocktakeScopes)[number];

export const stocktakeStatuses = ["open", "posted", "cancelled"] as const;
export type StocktakeStatus = (typeof stocktakeStatuses)[number];

export const stocktakeMessages = {
  alreadyOpen: "A count is already open. Finish or cancel it first.",
  noProducts: "There are no products to count here.",
  notOpen: "This count is no longer open.",
  lineNotFound: "That line is no longer in this count. Refresh the list.",
  outOfScope: (name: string) => `${name} isn't in this count.`,
  wholeUnits: "Count pieces in whole numbers.",
  nothingCounted: "Count at least one product before posting.",
  notFound: "That count no longer exists.",
} as const;

export const startStocktakeInputSchema = z.discriminatedUnion("scope", [
  z.strictObject({ scope: z.literal("full") }),
  z.strictObject({ scope: z.literal("category"), categoryId: z.uuid() }),
]);

export const stocktakeIdInputSchema = z.strictObject({ stocktakeId: z.uuid() });

export const stocktakeLinesQuerySchema = z.strictObject({
  stocktakeId: z.uuid(),
  query: z.string().max(200),
  limit: z.int().min(1).max(PRODUCT_SEARCH_MAX_LIMIT),
  offset: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export const stocktakeReviewFilters = ["all", "variance", "uncounted"] as const;
export type StocktakeReviewFilter = (typeof stocktakeReviewFilters)[number];

export const stocktakeReviewLinesQuerySchema = z.strictObject({
  stocktakeId: z.uuid(),
  filter: z.enum(stocktakeReviewFilters),
  limit: z.int().min(1).max(PRODUCT_SEARCH_MAX_LIMIT),
  offset: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export const pastStocktakesQuerySchema = z.strictObject({
  limit: z.int().min(1).max(PRODUCT_SEARCH_MAX_LIMIT),
  offset: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export const stocktakeScanInputSchema = z.strictObject({
  stocktakeId: z.uuid(),
  barcode: barcodeLookupInputSchema.shape.barcode,
});

export const recordCountInputSchema = z.strictObject({
  stocktakeId: z.uuid(),
  lineId: z.uuid(),
  countedMilli: z.int().min(0).max(maxQtyMilli),
});

export const stocktakeSummarySchema = z.strictObject({
  id: z.string(),
  scope: z.enum(stocktakeScopes),
  categoryName: z.string().nullable(),
  startedByName: z.string(),
  startedAt: z.iso.datetime(),
  lineCount: z.int(),
  countedCount: z.int(),
});

export const stocktakeReviewSchema = stocktakeSummarySchema.extend({
  status: z.enum(stocktakeStatuses),
  postedAt: z.iso.datetime().nullable(),
  postedByName: z.string().nullable(),
  skippedCount: z.int(),
  varianceLineCount: z.int(),
  shortValuePaisa: z.int().nullable(),
  surplusValuePaisa: z.int().nullable(),
  netValuePaisa: z.int().nullable(),
});

export const stocktakeReviewLineSchema = z.strictObject({
  id: z.string(),
  productId: z.string(),
  nameEn: z.string(),
  nameUr: z.string().nullable(),
  unit: z.enum(productUnits),
  isActive: z.boolean(),
  expectedMilli: z.int().nullable(),
  countedMilli: z.int().nullable(),
  countedAt: z.iso.datetime().nullable(),
  varianceMilli: z.int().nullable(),
  varianceValuePaisa: z.int().nullable(),
});

export const stocktakeLineSchema = z.strictObject({
  id: z.string(),
  productId: z.string(),
  nameEn: z.string(),
  nameUr: z.string().nullable(),
  unit: z.enum(productUnits),
  isActive: z.boolean(),
  categoryName: z.string(),
  onHandMilli: z.int(),
  countedMilli: z.int().nullable(),
  countedAt: z.iso.datetime().nullable(),
});

export const startStocktakeResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), stocktake: stocktakeSummarySchema }),
  refusal("already-open"),
  refusal("category-not-found"),
  refusal("no-products"),
]);

export const stocktakeLinesResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    items: z.array(stocktakeLineSchema),
    total: z.int(),
  }),
  refusal("not-open"),
]);

export const stocktakeScanResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    line: stocktakeLineSchema,
    packQtyMilli: z.int(),
  }),
  refusal("unknown-barcode"),
  refusal("out-of-scope"),
  refusal("not-open"),
]);

export const recordCountResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    line: stocktakeLineSchema,
    countedCount: z.int(),
  }),
  refusal("not-open"),
  refusal("not-found"),
  refusal("whole-units"),
]);

export const stocktakeReviewResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), review: stocktakeReviewSchema }),
  refusal("not-found"),
]);

export const stocktakeReviewLinesResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    items: z.array(stocktakeReviewLineSchema),
    total: z.int(),
  }),
  refusal("not-found"),
]);

export const pastStocktakesResultSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      id: z.string(),
      scope: z.enum(stocktakeScopes),
      categoryName: z.string().nullable(),
      status: z.enum(stocktakeStatuses),
      date: z.iso.datetime(),
    }),
  ),
  total: z.int(),
});

export const cancelStocktakeResultSchema = z.union([
  z.strictObject({ ok: z.literal(true) }),
  refusal("not-open"),
]);

export type StartStocktakeInput = z.input<typeof startStocktakeInputSchema>;
export type StocktakeLinesQuery = z.input<typeof stocktakeLinesQuerySchema>;
export type StocktakeScanInput = z.input<typeof stocktakeScanInputSchema>;
export type RecordCountInput = z.input<typeof recordCountInputSchema>;
export type StocktakeScanResult = z.infer<typeof stocktakeScanResultSchema>;
export type RecordCountResult = z.infer<typeof recordCountResultSchema>;
export type StocktakeSummary = z.infer<typeof stocktakeSummarySchema>;
export type StocktakeLine = z.infer<typeof stocktakeLineSchema>;
export type StartStocktakeResult = z.infer<typeof startStocktakeResultSchema>;
export type StocktakeLinesResult = z.infer<typeof stocktakeLinesResultSchema>;
export type CancelStocktakeResult = z.infer<typeof cancelStocktakeResultSchema>;
export type StocktakeReviewLinesQuery = z.input<typeof stocktakeReviewLinesQuerySchema>;
export type PastStocktakesQuery = z.input<typeof pastStocktakesQuerySchema>;
export type StocktakeReview = z.infer<typeof stocktakeReviewSchema>;
export type StocktakeReviewLine = z.infer<typeof stocktakeReviewLineSchema>;
export type StocktakeReviewResult = z.infer<typeof stocktakeReviewResultSchema>;
export type StocktakeReviewLinesResult = z.infer<typeof stocktakeReviewLinesResultSchema>;
export type PastStocktakesResult = z.infer<typeof pastStocktakesResultSchema>;
