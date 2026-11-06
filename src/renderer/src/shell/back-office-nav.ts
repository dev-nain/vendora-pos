export type BackOfficePage = "products" | "categories" | "users" | "audit" | "settings";

export interface BackOfficeEntry {
  page: BackOfficePage;
  label: string;
  group?: "Catalog";
}

export const backOfficeEntries: readonly BackOfficeEntry[] = [
  { page: "products", label: "Products", group: "Catalog" },
  { page: "categories", label: "Categories", group: "Catalog" },
  { page: "users", label: "Users" },
  { page: "audit", label: "Audit log" },
  { page: "settings", label: "Settings" },
];
