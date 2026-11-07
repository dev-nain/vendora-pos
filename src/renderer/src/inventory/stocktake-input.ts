import { maxQtyMilli } from "@shared/checkout";
import type { ProductUnit } from "@shared/products";
import { parseQuantityMilli, quantityInputText } from "../lib/quantity";

export type CountEntry =
  | { kind: "unchanged" }
  | { kind: "invalid"; message: string }
  | { kind: "valid"; countedMilli: number };

const invalidMessage = (unit: ProductUnit): string =>
  unit === "piece" ? "Enter a whole number, 0 or more." : "Enter 0 or more, up to 3 decimals.";

export function readCountEntry(text: string, initialText: string, unit: ProductUnit): CountEntry {
  if (text.trim() === "" || text === initialText) return { kind: "unchanged" };
  const parsed = parseQuantityMilli(text, unit);
  if (!parsed.ok || parsed.milli > maxQtyMilli) {
    return { kind: "invalid", message: invalidMessage(unit) };
  }
  return { kind: "valid", countedMilli: parsed.milli };
}

export function emptyCountMessage(unit: ProductUnit): string {
  return invalidMessage(unit);
}

const packUnitWords: Record<ProductUnit, string> = {
  piece: "pieces",
  kg: "kg",
  litre: "litres",
};

export function packHint(packQtyMilli: number, unit: ProductUnit): string | null {
  if (packQtyMilli === 1000) return null;
  return `Pack of ${quantityInputText(packQtyMilli, unit)} scanned. Enter the count in ${packUnitWords[unit]}.`;
}
