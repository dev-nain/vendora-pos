import {
  createSupplierInputSchema,
  type CreateSupplierInput,
  type Supplier,
} from "@shared/suppliers";

export interface SupplierFormValues {
  name: string;
  contactPerson: string;
  phone: string;
  ntn: string;
  notes: string;
}

export type SupplierField = keyof SupplierFormValues;

export type SupplierFormErrors = Partial<Record<SupplierField, string>>;

const fields: readonly SupplierField[] = ["name", "contactPerson", "phone", "ntn", "notes"];

export const emptySupplierForm = (): SupplierFormValues => ({
  name: "",
  contactPerson: "",
  phone: "",
  ntn: "",
  notes: "",
});

export const formFromSupplier = (supplier: Supplier): SupplierFormValues => ({
  name: supplier.name,
  contactPerson: supplier.contactPerson ?? "",
  phone: supplier.phone ?? "",
  ntn: supplier.ntn ?? "",
  notes: supplier.notes ?? "",
});

export const isSupplierFormDirty = (
  initial: SupplierFormValues,
  current: SupplierFormValues,
): boolean => fields.some((field) => initial[field] !== current[field]);

export function buildSupplierPayload(
  values: SupplierFormValues,
): { ok: true; payload: CreateSupplierInput } | { ok: false; errors: SupplierFormErrors } {
  const parsed = createSupplierInputSchema.safeParse(values);
  if (parsed.success) return { ok: true, payload: { ...values } };

  const errors: SupplierFormErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && fields.includes(field as SupplierField)) {
      errors[field as SupplierField] ??= issue.message;
    }
  }
  return { ok: false, errors };
}
