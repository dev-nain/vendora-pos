export type BackOfficePage =
  | "products"
  | "categories"
  | "stock"
  | "stocktake"
  | "users"
  | "settings";

export interface BackOfficeEntry {
  page: BackOfficePage;
  label: string;
  group?: "Catalog" | "Inventory";
}

export const backOfficeEntries: readonly BackOfficeEntry[] = [
  { page: "products", label: "Products", group: "Catalog" },
  { page: "categories", label: "Categories", group: "Catalog" },
  { page: "stock", label: "Stock", group: "Inventory" },
  { page: "stocktake", label: "Stocktake", group: "Inventory" },
  { page: "users", label: "Users" },
  { page: "settings", label: "Settings" },
];
