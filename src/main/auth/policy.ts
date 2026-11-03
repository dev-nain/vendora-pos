import type { UserRole } from "../db/schema";
import type { GatedDecision } from "../../shared/gated-actions";
import { hasPermission, type Permission } from "../../shared/permissions";
import { ForbiddenError } from "./errors";
import type { Session } from "./session";

export { permissions, hasPermission } from "../../shared/permissions";
export type { Permission } from "../../shared/permissions";

export { gatedActions, gatedActionDecision } from "../../shared/gated-actions";
export type { GatedAction, GatedDecision } from "../../shared/gated-actions";

export type ReportScope = "own-shift" | "all";

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
