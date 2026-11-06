import { z } from "zod";
import { refusal } from "./checkout";
import { PRODUCT_SEARCH_MAX_LIMIT, productUnits } from "./products";

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

export const stocktakeSummarySchema = z.strictObject({
  id: z.string(),
  scope: z.enum(stocktakeScopes),
  categoryName: z.string().nullable(),
  startedByName: z.string(),
  startedAt: z.iso.datetime(),
  lineCount: z.int(),
  countedCount: z.int(),
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

export const cancelStocktakeResultSchema = z.union([
  z.strictObject({ ok: z.literal(true) }),
  refusal("not-open"),
]);

export type StartStocktakeInput = z.input<typeof startStocktakeInputSchema>;
export type StocktakeLinesQuery = z.input<typeof stocktakeLinesQuerySchema>;
export type StocktakeSummary = z.infer<typeof stocktakeSummarySchema>;
export type StocktakeLine = z.infer<typeof stocktakeLineSchema>;
export type StartStocktakeResult = z.infer<typeof startStocktakeResultSchema>;
export type StocktakeLinesResult = z.infer<typeof stocktakeLinesResultSchema>;
export type CancelStocktakeResult = z.infer<typeof cancelStocktakeResultSchema>;
