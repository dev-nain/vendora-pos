import { z } from "zod";
import { ntnField, phoneField, textField } from "./settings";

export const supplierMessages = {
  notFound: "That supplier no longer exists. Refresh the list.",
} as const;

export const supplierNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name")
  .max(100, "Name must be 100 characters or fewer");

const supplierShape = {
  name: supplierNameSchema,
  contactPerson: textField(100, "Contact person is up to 100 characters."),
  phone: phoneField,
  ntn: ntnField,
  notes: textField(500, "Notes are up to 500 characters."),
};

export const createSupplierInputSchema = z.strictObject(supplierShape);

export const updateSupplierInputSchema = z.strictObject({ id: z.uuid(), ...supplierShape });

export const supplierIdInputSchema = z.strictObject({ id: z.uuid() });

export const supplierListInputSchema = z.strictObject({
  includeArchived: z.boolean().default(false),
});

export const supplierSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  contactPerson: z.string().nullable(),
  phone: z.string().nullable(),
  ntn: z.string().nullable(),
  notes: z.string().nullable(),
  isArchived: z.boolean(),
});

const refusal = <Reason extends string>(reason: Reason) =>
  z.strictObject({ ok: z.literal(false), reason: z.literal(reason), message: z.string() });

const okSupplier = z.strictObject({ ok: z.literal(true), supplier: supplierSchema });

export const createSupplierResultSchema = okSupplier;

export const updateSupplierResultSchema = z.union([okSupplier, refusal("not-found")]);

export const supplierStatusResultSchema = updateSupplierResultSchema;

export type Supplier = z.infer<typeof supplierSchema>;
export type CreateSupplierInput = z.input<typeof createSupplierInputSchema>;
export type UpdateSupplierInput = z.input<typeof updateSupplierInputSchema>;
export type SupplierIdInput = z.input<typeof supplierIdInputSchema>;
export type SupplierListInput = z.input<typeof supplierListInputSchema>;
export type CreateSupplierResult = z.infer<typeof createSupplierResultSchema>;
export type UpdateSupplierResult = z.infer<typeof updateSupplierResultSchema>;
export type SupplierStatusResult = z.infer<typeof supplierStatusResultSchema>;
