export type BackOfficePage = "products" | "categories" | "users" | "backup" | "settings";

export interface BackOfficeEntry {
  page: BackOfficePage;
  label: string;
  group?: "Catalog";
}

export const backOfficeEntries: readonly BackOfficeEntry[] = [
  { page: "products", label: "Products", group: "Catalog" },
  { page: "categories", label: "Categories", group: "Catalog" },
  { page: "users", label: "Users" },
  { page: "backup", label: "Backup" },
  { page: "settings", label: "Settings" },
];
