import { describe, expect, it } from "vitest";

import { categoryMessages } from "../../../shared/categories";
import { taxCategoryMessages } from "../../../shared/tax-categories";
import { categoryActions, deleteRefusalMessage, taxCategoryActions } from "./category-actions";

const custom = { isSystem: false };
const system = { isSystem: true };

describe("taxCategoryActions", () => {
  it("shows a manager no tax-category actions", () => {
    for (const row of [system, system, custom]) {
      expect(taxCategoryActions("manager", row)).toMatchObject({
        add: false,
        edit: false,
        remove: false,
      });
    }
  });

  it("lets the owner edit but not delete or re-rate a system row", () => {
    expect(taxCategoryActions("owner", system)).toEqual({
      add: true,
      edit: true,
      remove: false,
      canEditRate: false,
    });
  });

  it("lets the owner do everything on a custom row", () => {
    expect(taxCategoryActions("owner", custom)).toEqual({
      add: true,
      edit: true,
      remove: true,
      canEditRate: true,
    });
  });

  it("gives a cashier nothing", () => {
    expect(taxCategoryActions("cashier", custom)).toMatchObject({
      add: false,
      edit: false,
      remove: false,
    });
  });
});

describe("categoryActions", () => {
  it("lets a manager rename and delete a custom category", () => {
    expect(categoryActions("manager", custom)).toEqual({ add: true, rename: true, remove: true });
  });

  it("keeps the system category undeletable", () => {
    expect(categoryActions("manager", system).remove).toBe(false);
    expect(categoryActions("owner", system).rename).toBe(true);
  });

  it("gives a cashier nothing", () => {
    expect(categoryActions("cashier", custom)).toEqual({
      add: false,
      rename: false,
      remove: false,
    });
  });
});

describe("deleteRefusalMessage", () => {
  it("returns the in-use messages", () => {
    expect(
      deleteRefusalMessage({ ok: false, reason: "in-use", message: categoryMessages.inUse }),
    ).toBe(categoryMessages.inUse);
    expect(
      deleteRefusalMessage({ ok: false, reason: "in-use", message: taxCategoryMessages.inUse }),
    ).toBe(taxCategoryMessages.inUse);
  });

  it("returns the protected message", () => {
    expect(
      deleteRefusalMessage({
        ok: false,
        reason: "protected",
        message: categoryMessages.protected,
      }),
    ).toBe(categoryMessages.protected);
  });

  it("returns null on success", () => {
    expect(deleteRefusalMessage({ ok: true })).toBeNull();
  });
});
