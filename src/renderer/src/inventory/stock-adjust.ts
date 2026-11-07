import { maxQtyMilli } from "@shared/checkout";
import {
  movementReasons,
  type StockAdjustmentInput,
  type StockMovementReason,
} from "@shared/inventory";
import type { ProductUnit } from "@shared/products";
import { parseQuantityMilli } from "../lib/quantity";

export type StockAdjustMode = "change" | "count";

export interface StockAdjustForm {
  mode: StockAdjustMode;
  quantity: string;
  reason: StockMovementReason | null;
}

export type StockAdjustChange =
  | { ok: true; changeMilli: number; newOnHandMilli: number }
  | { ok: false; error: string };

export const stockAdjustModeItems: { value: StockAdjustMode; label: string }[] = [
  { value: "change", label: "Change by quantity" },
  { value: "count", label: "Set counted on-hand" },
];

export function parseSignedQuantityMilli(
  text: string,
  unit: ProductUnit,
): { ok: true; milli: number } | { ok: false } {
  const trimmed = text.trim();
  const sign = /^[+\-−]/.test(trimmed) ? trimmed[0] : "";
  const parsed = parseQuantityMilli(sign ? trimmed.slice(1) : trimmed, unit);
  if (!parsed.ok) return { ok: false };
  const negative = sign === "-" || sign === "−";
  return { ok: true, milli: negative && parsed.milli !== 0 ? -parsed.milli : parsed.milli };
}

export function changeFor(
  form: StockAdjustForm,
  onHandMilli: number,
  unit: ProductUnit,
): StockAdjustChange {
  const counting = form.mode === "count";
  if (form.quantity.trim() === "") {
    return { ok: false, error: counting ? "Enter the counted quantity" : "Enter a quantity" };
  }
  const parsed = counting
    ? parseQuantityMilli(form.quantity, unit)
    : parseSignedQuantityMilli(form.quantity, unit);
  if (!parsed.ok) {
    return {
      ok: false,
      error: unit === "piece" ? "Enter a whole number" : "Enter a number with up to 3 decimals",
    };
  }
  if (Math.abs(parsed.milli) > maxQtyMilli) {
    return { ok: false, error: "That quantity is too large" };
  }
  const changeMilli = counting ? parsed.milli - onHandMilli : parsed.milli;
  if (changeMilli === 0) {
    return {
      ok: false,
      error: counting
        ? "That matches on hand. Nothing to save."
        : "Enter a quantity other than zero",
    };
  }
  return { ok: true, changeMilli, newOnHandMilli: onHandMilli + changeMilli };
}

export const offeredReasons = (changeMilli: number | null): StockMovementReason[] =>
  changeMilli !== null && changeMilli > 0 ? ["correction"] : [...movementReasons];

export function toAdjustmentInput(
  form: StockAdjustForm,
  productId: string,
  unit: ProductUnit,
): StockAdjustmentInput | null {
  if (form.reason === null) return null;
  if (form.mode === "count") {
    const parsed = parseQuantityMilli(form.quantity, unit);
    if (!parsed.ok || parsed.milli > maxQtyMilli) return null;
    return { mode: "count", productId, countedMilli: parsed.milli, reason: form.reason };
  }
  const parsed = parseSignedQuantityMilli(form.quantity, unit);
  if (!parsed.ok || parsed.milli === 0 || Math.abs(parsed.milli) > maxQtyMilli) return null;
  return { mode: "change", productId, qtyMilli: parsed.milli, reason: form.reason };
}
