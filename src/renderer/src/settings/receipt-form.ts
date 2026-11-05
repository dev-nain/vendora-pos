import { receiptSettingsInputSchema, type ReceiptSettings } from "@shared/settings";

export type ReceiptForm = { [Field in keyof ReceiptSettings]: string };
export type ReceiptFormErrors = Partial<Record<keyof ReceiptSettings, string>>;

export function receiptFormFrom(settings: ReceiptSettings): ReceiptForm {
  return {
    name: settings.name ?? "",
    address: settings.address ?? "",
    phone: settings.phone ?? "",
    ntn: settings.ntn ?? "",
    strn: settings.strn ?? "",
    headerEn: settings.headerEn ?? "",
    headerUr: settings.headerUr ?? "",
    footerEn: settings.footerEn ?? "",
    footerUr: settings.footerUr ?? "",
  };
}

export function parseReceiptForm(
  form: ReceiptForm,
): { ok: true; settings: ReceiptSettings } | { ok: false; errors: ReceiptFormErrors } {
  const parsed = receiptSettingsInputSchema.safeParse(form);
  if (parsed.success) return { ok: true, settings: parsed.data };
  const errors: ReceiptFormErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && field in form) {
      errors[field as keyof ReceiptSettings] ??= issue.message;
    }
  }
  return { ok: false, errors };
}
