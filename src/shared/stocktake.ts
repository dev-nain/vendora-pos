export const stocktakeScopes = ["full", "category"] as const;
export type StocktakeScope = (typeof stocktakeScopes)[number];

export const stocktakeStatuses = ["open", "posted", "cancelled"] as const;
export type StocktakeStatus = (typeof stocktakeStatuses)[number];
