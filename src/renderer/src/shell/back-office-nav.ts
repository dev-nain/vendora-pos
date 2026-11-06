export type BackOfficePage = "products" | "categories" | "suppliers" | "users" | "settings";

export interface BackOfficeEntry {
  page: BackOfficePage;
  label: string;
  group?: "Catalog" | "Purchasing";
}

export const backOfficeEntries: readonly BackOfficeEntry[] = [
  { page: "products", label: "Products", group: "Catalog" },
  { page: "categories", label: "Categories", group: "Catalog" },
  { page: "suppliers", label: "Suppliers", group: "Purchasing" },
  { page: "users", label: "Users" },
  { page: "settings", label: "Settings" },
];
