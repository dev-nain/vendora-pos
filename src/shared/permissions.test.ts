import { describe, expect, it } from "vitest";

import { hasPermission } from "./permissions";

describe("shared permissions", () => {
  it("gives the manager products.manage but not settings or users", () => {
    expect(hasPermission("manager", "products.manage")).toBe(true);
    expect(hasPermission("manager", "settings.manage")).toBe(false);
    expect(hasPermission("manager", "users.manage")).toBe(false);
  });

  it("gives the owner all three", () => {
    expect(hasPermission("owner", "products.manage")).toBe(true);
    expect(hasPermission("owner", "settings.manage")).toBe(true);
    expect(hasPermission("owner", "users.manage")).toBe(true);
  });

  it("gives the cashier none of them", () => {
    expect(hasPermission("cashier", "products.manage")).toBe(false);
    expect(hasPermission("cashier", "settings.manage")).toBe(false);
    expect(hasPermission("cashier", "users.manage")).toBe(false);
  });
});
