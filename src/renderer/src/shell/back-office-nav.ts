export type BackOfficePage =
  | "products"
  | "categories"
  | "stock"
  | "low-stock"
  | "negative-stock"
  | "purchase-orders"
  | "suppliers"
  | "reports"
  | "users"
  | "audit"
  | "backup"
  | "settings";

export interface BackOfficeEntry {
  page: BackOfficePage;
  label: string;
  group?: "Catalog" | "Inventory" | "Purchasing";
}

export const backOfficeEntries: readonly BackOfficeEntry[] = [
  { page: "products", label: "Products", group: "Catalog" },
  { page: "categories", label: "Categories", group: "Catalog" },
  { page: "stock", label: "Stock", group: "Inventory" },
  { page: "low-stock", label: "Low stock", group: "Inventory" },
  { page: "negative-stock", label: "Negative stock", group: "Inventory" },
  { page: "purchase-orders", label: "Purchase orders", group: "Purchasing" },
  { page: "suppliers", label: "Suppliers", group: "Purchasing" },
  { page: "reports", label: "Reports" },
  { page: "users", label: "Users" },
  { page: "audit", label: "Audit log" },
  { page: "backup", label: "Backup" },
  { page: "settings", label: "Settings" },
];
