import { describe, expect, it } from "vitest";
import type { LoginUser } from "@shared/auth";
import { approverChoices } from "./approvers";

const users: LoginUser[] = [
  { id: "1", displayName: "Bilal", role: "cashier" },
  { id: "2", displayName: "Sana", role: "manager" },
  { id: "3", displayName: "Imran", role: "owner" },
  { id: "4", displayName: "Zoya", role: "cashier" },
  { id: "5", displayName: "Hira", role: "manager" },
];

describe("approverChoices", () => {
  it("keeps managers and owners and drops cashiers, in order", () => {
    expect(approverChoices(users, "drawer.open-no-sale").map((u) => u.displayName)).toEqual([
      "Sana",
      "Imran",
      "Hira",
    ]);
  });

  it("returns nothing when there are only cashiers", () => {
    expect(approverChoices([users[0]!, users[3]!], "stock.adjust")).toEqual([]);
  });
});
