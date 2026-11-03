import type { z } from "zod";

import type { userRoleSchema } from "./auth";

type UserRole = z.infer<typeof userRoleSchema>;

export const permissions = [
  "sale.sell",
  "sale.hold-resume",
  "receipt.reprint",
  "discount.within-limit",
  "return.with-receipt",
  "reports.view",
  "products.manage",
  "purchasing.manage",
  "stock.manage",
  "users.manage",
  "settings.manage",
  "license.manage",
  "backup.restore",
] as const;
export type Permission = (typeof permissions)[number];

const rolePermissions: Record<UserRole, ReadonlySet<Permission>> = {
  cashier: new Set<Permission>([
    "sale.sell",
    "sale.hold-resume",
    "receipt.reprint",
    "discount.within-limit",
    "return.with-receipt",
    "reports.view",
  ]),
  manager: new Set<Permission>([
    "sale.sell",
    "sale.hold-resume",
    "receipt.reprint",
    "discount.within-limit",
    "return.with-receipt",
    "reports.view",
    "products.manage",
    "purchasing.manage",
    "stock.manage",
  ]),
  owner: new Set<Permission>([
    "sale.sell",
    "sale.hold-resume",
    "receipt.reprint",
    "discount.within-limit",
    "return.with-receipt",
    "reports.view",
    "products.manage",
    "purchasing.manage",
    "stock.manage",
    "users.manage",
    "settings.manage",
    "license.manage",
    "backup.restore",
  ]),
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return rolePermissions[role].has(permission);
}
