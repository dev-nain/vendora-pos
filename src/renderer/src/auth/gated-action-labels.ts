import type { GatedAction } from "@shared/gated-actions";

export const gatedActionLabels: Record<GatedAction, string> = {
  "discount.above-limit": "Approve a discount above the cashier limit",
  "price.override": "Approve a price override",
  "sale.void-completed": "Approve voiding a completed sale",
  "return.without-receipt": "Approve a return without a receipt",
  "drawer.open-no-sale": "Approve opening the drawer without a sale",
  "stock.adjust": "Approve a stock adjustment",
  "product.cost-change": "Approve a cost price change",
};
