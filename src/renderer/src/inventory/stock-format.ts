import type { StockMovementRow } from "@shared/inventory";
import type { ProductUnit } from "@shared/products";
import { formatQuantity } from "../lib/quantity";

export const onHandText = (milli: number, unit: ProductUnit): string =>
  formatQuantity(milli, unit).replace(/^-/, "−");

export const negativeClass = (value: number): string => (value < 0 ? "text-critical" : "");

export const rowMoveTarget = (key: string, index: number, last: number): number | null =>
  key === "ArrowDown"
    ? Math.min(index + 1, last)
    : key === "ArrowUp"
      ? Math.max(index - 1, 0)
      : key === "Home"
        ? 0
        : key === "End"
          ? last
          : null;

export const signedQuantityText = (milli: number, unit: ProductUnit): string => {
  const text = onHandText(milli, unit);
  return milli > 0 ? `+${text}` : text;
};

export const movementTypeLabels: Record<StockMovementRow["type"], string> = {
  opening: "Opening",
  sale: "Sale",
  return: "Return",
  receipt: "Receipt",
  adjustment: "Adjustment",
  stocktake: "Stocktake",
  damage: "Damage",
  purchase_return: "Purchase return",
};

export const movementReasonLabels: Record<NonNullable<StockMovementRow["reason"]>, string> = {
  damage: "Damage",
  expiry: "Expiry",
  theft: "Theft",
  correction: "Correction",
};
