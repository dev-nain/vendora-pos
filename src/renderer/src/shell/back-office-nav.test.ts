import { describe, expect, it } from "vitest";

import { backOfficePages, canOpenBackOffice } from "./back-office-nav";

const pagesFor = (role: "owner" | "manager" | "cashier") =>
  backOfficePages(role).map((entry) => entry.page);

describe("back office nav", () => {
  it("lists every page for the owner", () => {
    expect(pagesFor("owner")).toEqual(["products", "categories", "users", "settings"]);
  });

  it("lists only the catalog pages for a manager", () => {
    expect(pagesFor("manager")).toEqual(["products", "categories"]);
  });

  it("never shows a cashier the products page", () => {
    expect(pagesFor("cashier")).toEqual([]);
    expect(pagesFor("cashier")).not.toContain("products");
  });

  it("opens the back office for owner and manager only", () => {
    expect(canOpenBackOffice("owner")).toBe(true);
    expect(canOpenBackOffice("manager")).toBe(true);
    expect(canOpenBackOffice("cashier")).toBe(false);
  });
});
