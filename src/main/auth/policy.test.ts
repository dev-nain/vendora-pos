import { describe, expect, it } from "vitest";
import { userRoles, type UserRole } from "../db/schema";
import { ForbiddenError } from "./errors";
import {
  discountDecision,
  gatedActionDecision,
  gatedActions,
  hasPermission,
  permissions,
  reportScope,
  requirePermission,
  type Permission,
} from "./policy";
import type { Session } from "./session";

const all = { cashier: true, manager: true, owner: true };
const managerUp = { cashier: false, manager: true, owner: true };
const ownerOnly = { cashier: false, manager: false, owner: true };

const expected: Record<Permission, Record<UserRole, boolean>> = {
  "sale.sell": all,
  "sale.hold-resume": all,
  "receipt.reprint": all,
  "discount.within-limit": all,
  "return.with-receipt": all,
  "reports.view": all,
  "products.manage": managerUp,
  "purchasing.manage": managerUp,
  "stock.manage": managerUp,
  "users.manage": ownerOnly,
  "settings.manage": ownerOnly,
  "license.manage": ownerOnly,
  "backup.restore": ownerOnly,
};

const sessionFor = (role: UserRole): Session => ({
  userId: "u1",
  role,
  storeId: "s1",
  loggedInAt: new Date(0),
});

const permissionCases = userRoles.flatMap((role) =>
  permissions.map((permission) => [role, permission, expected[permission][role]] as const),
);

describe("permission matrix", () => {
  it("has a row for every permission", () => {
    expect(Object.keys(expected).toSorted()).toEqual([...permissions].toSorted());
    for (const row of Object.values(expected)) {
      expect(Object.keys(row).toSorted()).toEqual([...userRoles].toSorted());
    }
  });

  it.each(permissionCases)("%s / %s -> %s", (role, permission, granted) => {
    expect(hasPermission(role, permission)).toBe(granted);
    const call = () => requirePermission(sessionFor(role), permission);
    if (granted) {
      expect(call).not.toThrow();
    } else {
      expect(call).toThrow(ForbiddenError);
      expect(call).toThrow(expect.objectContaining({ code: "forbidden", permission }));
    }
  });
});

const gatedCases = userRoles.flatMap((role) =>
  gatedActions.map(
    (action) => [role, action, role === "cashier" ? "needs-approval" : "allowed"] as const,
  ),
);

describe("gated actions", () => {
  it("lists the eight Core 3 actions", () => {
    expect(gatedActions).toHaveLength(8);
  });

  it.each(gatedCases)("%s / %s -> %s", (role, action, decision) => {
    expect(gatedActionDecision(role, action)).toBe(decision);
  });
});

describe("reportScope", () => {
  it.each([
    ["cashier", "own-shift"],
    ["manager", "all"],
    ["owner", "all"],
  ] as const)("%s -> %s", (role, scope) => {
    expect(reportScope(role)).toBe(scope);
  });
});

describe("discountDecision", () => {
  it.each([
    ["cashier", 0, "allowed"],
    ["cashier", 499, "allowed"],
    ["cashier", 500, "allowed"],
    ["cashier", 501, "needs-approval"],
    ["manager", 10000, "allowed"],
    ["owner", 10000, "allowed"],
  ] as const)("%s at %i bps with limit 500 -> %s", (role, bps, decision) => {
    expect(discountDecision(role, bps, 500)).toBe(decision);
  });
});
