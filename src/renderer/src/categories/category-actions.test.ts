import { describe, expect, it } from "vitest";

import { categoryMessages } from "../../../shared/categories";
import { taxCategoryMessages } from "../../../shared/tax-categories";
import { categoryActions, deleteRefusalMessage, taxCategoryActions } from "./category-actions";

const custom = { isSystem: false };
const system = { isSystem: true };

describe("taxCategoryActions", () => {
  it("lets everyone edit but not delete or re-rate a system row", () => {
    expect(taxCategoryActions(system)).toEqual({
      add: true,
      edit: true,
      remove: false,
      canEditRate: false,
    });
  });

  it("allows everything on a custom row", () => {
    expect(taxCategoryActions(custom)).toEqual({
      add: true,
      edit: true,
      remove: true,
      canEditRate: true,
    });
  });
});

describe("categoryActions", () => {
  it("allows rename and delete on a custom category", () => {
    expect(categoryActions(custom)).toEqual({ add: true, rename: true, remove: true });
  });

  it("keeps the system category undeletable but renamable", () => {
    expect(categoryActions(system)).toEqual({ add: true, rename: true, remove: false });
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
