import type { BillLine, Discount } from "@shared/checkout";
import { rateInputText } from "../categories/tax-rate-input";
import { formatRupees } from "../lib/money";
import { formatQuantity } from "../lib/quantity";

const MINUS = "−";

export const isPackLine = (line: Pick<BillLine, "unit" | "packQtyMilli">): boolean =>
  line.packQtyMilli !== 1000;

export const isWeighedLine = (line: Pick<BillLine, "unit" | "packQtyMilli">): boolean =>
  line.unit !== "piece" && !isPackLine(line);

export function lineQuantityText(line: BillLine): string {
  const text = isWeighedLine(line)
    ? formatQuantity(line.qtyMilli, line.unit)
    : String(line.qtyMilli / 1000);
  return text.replace(/^-/, MINUS);
}

export function lineDetail(line: BillLine): string {
  const price = formatRupees(line.unitPricePaisa);
  let detail: string;
  if (isPackLine(line)) {
    detail = `${lineQuantityText(line)} × Pack (${formatQuantity(line.packQtyMilli, line.unit)}) at ${price}`;
  } else {
    detail = `${lineQuantityText(line)} × ${price}`;
  }
  return line.priceType === "manual" && !line.isMisc ? `${detail} · Price changed` : detail;
}

export function discountText(discount: Discount): string {
  return discount.kind === "percent"
    ? `${MINUS}${rateInputText(discount.bps)}%`
    : `${MINUS}${formatRupees(discount.amountPaisa)}`;
}

export function billDiscountLabel(discount: Discount): string {
  return discount.kind === "percent"
    ? `Bill discount ${rateInputText(discount.bps)}%`
    : `Bill discount ${formatRupees(discount.amountPaisa)}`;
}

export { negativeRupees, signedRupees } from "@shared/money";

export const itemCountText = (count: number): string =>
  `${count} ${count === 1 ? "item" : "items"}`;
