import { buyerSchema, type BuyerInput } from "@shared/checkout";

export type BuyerText = { name: string; ntn: string; cnic: string; phone: string };

export type BuyerField = keyof BuyerText;

export type BuyerParse =
  | { ok: true; buyer: BuyerInput | undefined }
  | { ok: false; errors: Partial<Record<BuyerField, string>> };

export const buyerFields: readonly BuyerField[] = ["name", "phone", "ntn", "cnic"];

export const emptyBuyerText = (): BuyerText => ({ name: "", ntn: "", cnic: "", phone: "" });

export const filledBuyerCount = (text: BuyerText): number =>
  buyerFields.filter((field) => text[field].trim() !== "").length;

export function parseBuyer(text: BuyerText): BuyerParse {
  const filled: BuyerInput = {};
  for (const field of buyerFields) {
    const value = text[field].trim();
    if (value !== "") filled[field] = value;
  }
  if (Object.keys(filled).length === 0) return { ok: true, buyer: undefined };

  const result = buyerSchema.safeParse(filled);
  if (result.success) return { ok: true, buyer: filled };

  const errors: Partial<Record<BuyerField, string>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && field in text && errors[field as BuyerField] === undefined) {
      errors[field as BuyerField] = issue.message;
    }
  }
  return { ok: false, errors };
}
