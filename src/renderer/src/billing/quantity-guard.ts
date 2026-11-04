import type { ProductUnit } from "@shared/products";
import { formatRupees } from "../lib/money";
import { formatQuantity } from "../lib/quantity";
import { weightTotalPaisa } from "./weight-total";

const countLimitMilli = 100_000;
const weightLimitMilli = 25_000;

interface GuardInput {
  name: string;
  unit: ProductUnit;
  packQtyMilli: number;
  qtyMilli: number;
  unitPricePaisa: number;
}

export function quantityGuardMessage(input: GuardInput): string | null {
  const weighed = input.unit !== "piece" && input.packQtyMilli === 1000;
  const limit = weighed ? weightLimitMilli : countLimitMilli;
  if (input.qtyMilli < limit) return null;
  const quantity = weighed
    ? formatQuantity(input.qtyMilli, input.unit)
    : String(input.qtyMilli / 1000);
  const total = formatRupees(weightTotalPaisa(input.qtyMilli, input.unitPricePaisa));
  return `Set quantity to ${quantity} × ${input.name} (${total})?`;
}
