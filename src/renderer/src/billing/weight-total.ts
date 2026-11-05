import type { ProductUnit } from "@shared/products";
import { formatRupees } from "../lib/money";
import { formatQuantity, parseQuantityMilli } from "../lib/quantity";

export function weightTotalPaisa(qtyMilli: number, unitPricePaisa: number): number {
  const product = BigInt(qtyMilli) * BigInt(unitPricePaisa);
  return Number((product + 500n) / 1000n);
}

export type WeightPreview =
  | { ok: true; qtyMilli: number; totalPaisa: number; text: string }
  | { ok: false };

export function weightPreview(
  input: string,
  unit: ProductUnit,
  unitPricePaisa: number,
): WeightPreview {
  const parsed = parseQuantityMilli(input, unit);
  if (!parsed.ok || parsed.milli === 0) return { ok: false };
  const totalPaisa = weightTotalPaisa(parsed.milli, unitPricePaisa);
  return {
    ok: true,
    qtyMilli: parsed.milli,
    totalPaisa,
    text: `${formatQuantity(parsed.milli, unit)} × ${formatRupees(unitPricePaisa)} = ${formatRupees(totalPaisa)}`,
  };
}
