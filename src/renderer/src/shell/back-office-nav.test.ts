import { describe, expect, it } from "vitest";

import { backOfficeEntries } from "./back-office-nav";

describe("back office nav", () => {
  it("lists every page in order", () => {
    expect(backOfficeEntries.map((entry) => entry.page)).toEqual([
      "products",
      "categories",
      "users",
      "backup",
      "settings",
    ]);
  });

  it("groups products and categories under Catalog", () => {
    expect(
      backOfficeEntries.filter((entry) => entry.group === "Catalog").map((entry) => entry.page),
    ).toEqual(["products", "categories"]);
  });
});
