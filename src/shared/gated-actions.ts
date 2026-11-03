export const gatedActions = [
  "discount.above-limit",
  "price.override",
  "sale.void-completed",
  "return.without-receipt",
  "drawer.open-no-sale",
  "stock.adjust",
  "product.cost-change",
] as const;
export type GatedAction = (typeof gatedActions)[number];

export type GatedDecision = "allowed" | "needs-approval";

export function gatedActionDecision(
  role: "owner" | "manager" | "cashier",
  _action: GatedAction,
): GatedDecision {
  return role === "cashier" ? "needs-approval" : "allowed";
}
