import { z } from "zod";
import { categoryNameSchema } from "./categories";

export const taxCategoryMessages = {
  nameTaken: "A tax category with that name already exists.",
  notFound: "That category no longer exists. Refresh the list.",
  inUse: "Products still use this tax category. Move them to another tax category first.",
  protected: "This default can be renamed but not deleted.",
  rateLocked: "The rate of this default tax category can't be changed.",
  rateRequired: "Enter a tax rate from 0% to 100%.",
} as const;

export const taxRateBpsSchema = z.int().min(0).max(10000);

export const createTaxCategoryInputSchema = z.strictObject({
  name: categoryNameSchema,
  rateBps: taxRateBpsSchema,
});

export const updateTaxCategoryInputSchema = z.strictObject({
  id: z.uuid(),
  name: categoryNameSchema,
  rateBps: taxRateBpsSchema.nullable(),
});

export const taxCategoryIdInputSchema = z.strictObject({ id: z.uuid() });

export const taxCategorySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  rateBps: z.number().nullable(),
  isSystem: z.boolean(),
});

const refusal = <Reason extends string>(reason: Reason) =>
  z.strictObject({ ok: z.literal(false), reason: z.literal(reason), message: z.string() });

const nameTakenSchema = refusal("name-taken");
const notFoundSchema = refusal("not-found");

export const createTaxCategoryResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), taxCategory: taxCategorySchema }),
  nameTakenSchema,
]);

export const updateTaxCategoryResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), taxCategory: taxCategorySchema }),
  nameTakenSchema,
  refusal("rate-locked"),
  refusal("rate-required"),
  notFoundSchema,
]);

export const deleteTaxCategoryResultSchema = z.union([
  z.strictObject({ ok: z.literal(true) }),
  refusal("in-use"),
  refusal("protected"),
  notFoundSchema,
]);

export type TaxCategory = z.infer<typeof taxCategorySchema>;
export type CreateTaxCategoryInput = z.input<typeof createTaxCategoryInputSchema>;
export type UpdateTaxCategoryInput = z.input<typeof updateTaxCategoryInputSchema>;
export type CreateTaxCategoryResult = z.infer<typeof createTaxCategoryResultSchema>;
export type UpdateTaxCategoryResult = z.infer<typeof updateTaxCategoryResultSchema>;
export type DeleteTaxCategoryResult = z.infer<typeof deleteTaxCategoryResultSchema>;
