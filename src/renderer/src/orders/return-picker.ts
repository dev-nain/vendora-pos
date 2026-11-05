import type { ProductUnit } from "@shared/products";
import { returnMessages, type ReturnableLine } from "@shared/returns";
import { formatQuantity, parseQuantityMilli } from "../lib/quantity";

export const wholeUnitsError = "Pieces and packs return in whole units.";
export const invalidQuantityError = "Enter a valid quantity.";

type PickerLine = Pick<ReturnableLine, "unit" | "packQtyMilli" | "leftQtyMilli">;

export const isWholeOnly = (line: Pick<ReturnableLine, "unit" | "packQtyMilli">): boolean =>
  line.unit === "piece" || line.packQtyMilli !== 1000;

const entryUnit = (line: PickerLine): ProductUnit => (isWholeOnly(line) ? "piece" : line.unit);

export function returnQuantityText(milli: number, line: PickerLine): string {
  return isWholeOnly(line) ? String(milli / 1000) : formatQuantity(milli, line.unit);
}

export type QuantityEntry =
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "quantity"; milli: number };

export function readQuantity(text: string, line: PickerLine): QuantityEntry {
  if (text.trim() === "") return { kind: "empty" };
  const parsed = parseQuantityMilli(text, entryUnit(line));
  if (!parsed.ok) {
    return {
      kind: "error",
      message:
        isWholeOnly(line) && /^\d+\.\d*$/.test(text.trim())
          ? wholeUnitsError
          : invalidQuantityError,
    };
  }
  if (parsed.milli === 0) return { kind: "empty" };
  if (parsed.milli > line.leftQtyMilli) {
    return { kind: "error", message: returnMessages.overSold(line.leftQtyMilli, line.unit) };
  }
  return { kind: "quantity", milli: parsed.milli };
}

export function rowError(text: string, line: PickerLine): string | null {
  const entry = readQuantity(text, line);
  return entry.kind === "error" ? entry.message : null;
}

export function canRefund(
  lines: readonly (ReturnableLine & { saleLineId: string })[],
  texts: Readonly<Record<string, string>>,
): boolean {
  let any = false;
  for (const line of lines) {
    const entry = readQuantity(texts[line.saleLineId] ?? "", line);
    if (entry.kind === "error") return false;
    if (entry.kind === "quantity") any = true;
  }
  return any;
}

export function buildReturnLines(
  lines: readonly ReturnableLine[],
  texts: Readonly<Record<string, string>>,
): { saleLineId: string; qtyMilli: number }[] {
  return lines.flatMap((line) => {
    const entry = readQuantity(texts[line.saleLineId] ?? "", line);
    return entry.kind === "quantity"
      ? [{ saleLineId: line.saleLineId, qtyMilli: entry.milli }]
      : [];
  });
}
