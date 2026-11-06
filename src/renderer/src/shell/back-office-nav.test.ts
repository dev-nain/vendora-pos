import { describe, expect, it } from "vitest";

import { backOfficeEntries } from "./back-office-nav";

describe("back office nav", () => {
  it("lists every page in order", () => {
    expect(backOfficeEntries.map((entry) => entry.page)).toEqual([
      "products",
      "categories",
      "stock",
      "low-stock",
      "users",
      "settings",
    ]);
  });

  it("groups products and categories under Catalog", () => {
    expect(
      backOfficeEntries.filter((entry) => entry.group === "Catalog").map((entry) => entry.page),
    ).toEqual(["products", "categories"]);
  });

  it("groups stock and low stock under Inventory", () => {
    expect(
      backOfficeEntries.filter((entry) => entry.group === "Inventory").map((entry) => entry.label),
    ).toEqual(["Stock", "Low stock"]);
  });
});
