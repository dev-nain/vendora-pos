import type { SafeUser } from "@shared/auth";
import { hasPermission, type Permission } from "../../../shared/permissions";

export type BackOfficePage = "products" | "categories" | "users" | "settings";

export interface BackOfficeEntry {
  page: BackOfficePage;
  label: string;
  group?: "Catalog";
  permission: Permission;
}

export const backOfficeEntries: readonly BackOfficeEntry[] = [
  { page: "products", label: "Products", group: "Catalog", permission: "products.manage" },
  { page: "categories", label: "Categories", group: "Catalog", permission: "products.manage" },
  { page: "users", label: "Users", permission: "users.manage" },
  { page: "settings", label: "Settings", permission: "settings.manage" },
];

export function backOfficePages(role: SafeUser["role"]): BackOfficeEntry[] {
  return backOfficeEntries.filter((entry) => hasPermission(role, entry.permission));
}

export function canOpenBackOffice(role: SafeUser["role"]): boolean {
  return backOfficePages(role).length > 0;
}
