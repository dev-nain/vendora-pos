import type { UserRole } from "../db/schema";
import type { GatedDecision } from "../../shared/gated-actions";
import { ForbiddenError } from "./errors";
import type { Session } from "./session";

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

export { gatedActions, gatedActionDecision } from "../../shared/gated-actions";
export type { GatedAction, GatedDecision } from "../../shared/gated-actions";

export type ReportScope = "own-shift" | "all";

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

export function requirePermission(session: Session, permission: Permission): void {
  if (!hasPermission(session.role, permission)) throw new ForbiddenError(permission);
}

export function reportScope(role: UserRole): ReportScope {
  return role === "cashier" ? "own-shift" : "all";
}

export function discountDecision(
  role: UserRole,
  discountBps: number,
  cashierLimitBps: number,
): GatedDecision {
  if (role !== "cashier") return "allowed";
  return discountBps <= cashierLimitBps ? "allowed" : "needs-approval";
}
