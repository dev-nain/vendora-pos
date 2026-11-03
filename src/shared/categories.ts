import { z } from "zod";

export const categoryMessages = {
  nameTaken: "A category with that name already exists.",
  notFound: "That category no longer exists. Refresh the list.",
  inUse: "Products still use this category. Move them to another category first.",
  protected: "This default can be renamed but not deleted.",
} as const;

export const categoryNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name")
  .max(64, "Name must be 64 characters or fewer");

export const createCategoryInputSchema = z.strictObject({ name: categoryNameSchema });

export const renameCategoryInputSchema = z.strictObject({
  id: z.uuid(),
  name: categoryNameSchema,
});

export const categoryIdInputSchema = z.strictObject({ id: z.uuid() });

export const categorySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  isSystem: z.boolean(),
});

const refusal = <Reason extends string>(reason: Reason) =>
  z.strictObject({ ok: z.literal(false), reason: z.literal(reason), message: z.string() });

const nameTakenSchema = refusal("name-taken");
const notFoundSchema = refusal("not-found");

export const createCategoryResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), category: categorySchema }),
  nameTakenSchema,
]);

export const renameCategoryResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), category: categorySchema }),
  nameTakenSchema,
  notFoundSchema,
]);

export const deleteCategoryResultSchema = z.union([
  z.strictObject({ ok: z.literal(true) }),
  refusal("in-use"),
  refusal("protected"),
  notFoundSchema,
]);

export type Category = z.infer<typeof categorySchema>;
export type CreateCategoryInput = z.input<typeof createCategoryInputSchema>;
export type RenameCategoryInput = z.input<typeof renameCategoryInputSchema>;
export type CreateCategoryResult = z.infer<typeof createCategoryResultSchema>;
export type RenameCategoryResult = z.infer<typeof renameCategoryResultSchema>;
export type DeleteCategoryResult = z.infer<typeof deleteCategoryResultSchema>;
