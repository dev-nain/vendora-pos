import type { ProductUnit } from "./products";

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
