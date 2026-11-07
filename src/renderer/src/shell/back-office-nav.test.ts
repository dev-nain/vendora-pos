import { describe, expect, it } from "vitest";

import { backOfficeEntries } from "./back-office-nav";

describe("back office nav", () => {
  it("lists every page in order", () => {
    expect(backOfficeEntries.map((entry) => entry.page)).toEqual([
      "products",
      "categories",
      "stock",
      "low-stock",
      "negative-stock",
      "stocktake",
      "suppliers",
      "users",
      "audit",
      "backup",
      "settings",
    ]);
  });

  it("groups products and categories under Catalog", () => {
    expect(
      backOfficeEntries.filter((entry) => entry.group === "Catalog").map((entry) => entry.page),
    ).toEqual(["products", "categories"]);
  });

  it("groups stock, low stock, negative stock and stocktake under Inventory", () => {
    expect(
      backOfficeEntries.filter((entry) => entry.group === "Inventory").map((entry) => entry.page),
    ).toEqual(["stock", "low-stock", "negative-stock", "stocktake"]);
  });

  it("groups suppliers under Purchasing", () => {
    expect(
      backOfficeEntries.filter((entry) => entry.group === "Purchasing").map((entry) => entry.page),
    ).toEqual(["suppliers"]);
  });
});
