import { describe, expect, it } from "vitest";

import { backOfficePages, canOpenBackOffice } from "./back-office-nav";

const pagesFor = (role: "owner" | "manager" | "cashier") =>
  backOfficePages(role).map((entry) => entry.page);

describe("back office nav", () => {
  it("lists every page for the owner", () => {
    expect(pagesFor("owner")).toEqual(["categories", "users", "settings"]);
  });

  it("lists only categories for a manager", () => {
    expect(pagesFor("manager")).toEqual(["categories"]);
  });

  it("lists nothing for a cashier", () => {
    expect(pagesFor("cashier")).toEqual([]);
  });

  it("opens the back office for owner and manager only", () => {
    expect(canOpenBackOffice("owner")).toBe(true);
    expect(canOpenBackOffice("manager")).toBe(true);
    expect(canOpenBackOffice("cashier")).toBe(false);
  });
});
