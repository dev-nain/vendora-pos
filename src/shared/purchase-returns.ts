export const purchaseReturnReasons = ["damaged", "expired", "wrong_item", "over_supplied"] as const;
export type PurchaseReturnReason = (typeof purchaseReturnReasons)[number];
