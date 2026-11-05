import { formatRupees } from "./money";
import type { ProductUnit } from "./products";
import { formatQuantity } from "./quantity";

export function refundCapPaisa(input: {
  availablePaisa: number;
  linkedRefundPaisa: number;
  netRefundPaisa: number;
}): number {
  return Math.max(0, Math.min(input.availablePaisa, input.linkedRefundPaisa, input.netRefundPaisa));
}

export const returnMessages = {
  oneSale: "You can only return items from one sale per bill.",
  linkedLocked: "This line comes from a receipt. Change its quantity or delete it.",
  notReturnable: "Return lines can't be returned again.",
  noStock: "Misc items have no stock.",
  notReturn: "Only return lines go to damaged stock.",
  overSold: (leftMilli: number, unit: ProductUnit): string =>
    `Only ${unit === "piece" ? String(Math.floor(leftMilli / 1000)) : formatQuantity(leftMilli, unit)} left to return.`,
  overCap: (methodLabel: string, paisa: number): string =>
    `${methodLabel} can refund up to ${formatRupees(paisa)}.`,
  refundExact: (paisa: number): string => `Refund exactly ${formatRupees(paisa)}.`,
} as const;
