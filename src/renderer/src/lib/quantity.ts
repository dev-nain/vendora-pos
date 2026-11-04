import type { ProductUnit } from "@shared/products";

const wholePattern = /^\d{1,12}$/;
const decimalPattern = /^(\d{1,12})(?:\.(\d{1,3}))?$/;

export function parseQuantityMilli(
  text: string,
  unit: ProductUnit,
): { ok: true; milli: number } | { ok: false } {
  const trimmed = text.trim();
  if (unit === "piece") {
    return wholePattern.test(trimmed) ? { ok: true, milli: Number(trimmed) * 1000 } : { ok: false };
  }
  const match = decimalPattern.exec(trimmed);
  if (!match) return { ok: false };
  return { ok: true, milli: Number(match[1]) * 1000 + Number((match[2] ?? "").padEnd(3, "0")) };
}

export function quantityInputText(milli: number, unit: ProductUnit): string {
  if (!Number.isInteger(milli) || milli < 0) throw new Error("Quantity must be whole milli-units");
  const whole = Math.floor(milli / 1000);
  if (unit === "piece") return String(whole);
  const fraction = String(milli % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

const unitSuffix: Record<ProductUnit, string> = { piece: "pcs", kg: "kg", litre: "L" };

export function formatQuantity(milli: number, unit: ProductUnit): string {
  if (!Number.isInteger(milli)) throw new Error("Quantity must be whole milli-units");
  const sign = milli < 0 ? "-" : "";
  const abs = Math.abs(milli);
  const whole = Math.floor(abs / 1000);
  const amount =
    unit === "piece" ? String(whole) : `${whole}.${String(abs % 1000).padStart(3, "0")}`;
  return `${sign}${amount} ${unitSuffix[unit]}`;
}
