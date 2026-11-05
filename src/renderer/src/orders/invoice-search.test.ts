import { describe, expect, it } from "vitest";
import type { OrderSummary } from "@shared/sales";
import {
  dateQueryFrom,
  moveOrderSelection,
  searchQueryFrom,
  selectAfterSearch,
} from "./invoice-search";

const order = (id: string): OrderSummary => ({
  id,
  invoiceNo: `T1-${id}`,
  createdAt: "2026-10-27T10:00:00.000Z",
  cashierName: "Ayesha",
  totalPaisa: 100,
  type: "sale",
  methods: ["cash"],
});

const orders = [order("a"), order("b"), order("c")];

describe("searchQueryFrom", () => {
  it("trims typed or scanned text and ignores an empty box", () => {
    expect(searchQueryFrom(" T1-000231\n")).toEqual({ invoiceNo: "T1-000231" });
    expect(searchQueryFrom("231")).toEqual({ invoiceNo: "231" });
    expect(searchQueryFrom("   ")).toBeNull();
    expect(searchQueryFrom("")).toBeNull();
  });

  it("keeps the text inside the 32 character limit", () => {
    expect(searchQueryFrom("9".repeat(40))).toEqual({ invoiceNo: "9".repeat(32) });
  });
});

describe("dateQueryFrom", () => {
  it("accepts a picked day and ignores a cleared or partial one", () => {
    expect(dateQueryFrom("2026-10-27")).toEqual({ date: "2026-10-27" });
    expect(dateQueryFrom("")).toBeNull();
    expect(dateQueryFrom("2026-10")).toBeNull();
  });
});

describe("selectAfterSearch", () => {
  it("selects the first row, or nothing when there are no results", () => {
    expect(selectAfterSearch(orders)).toBe("a");
    expect(selectAfterSearch([])).toBeNull();
  });
});

describe("moveOrderSelection", () => {
  it("moves down and up and stops at the ends", () => {
    expect(moveOrderSelection(orders, "a", 1)).toBe("b");
    expect(moveOrderSelection(orders, "c", 1)).toBe("c");
    expect(moveOrderSelection(orders, "b", -1)).toBe("a");
    expect(moveOrderSelection(orders, "a", -1)).toBe("a");
  });

  it("starts at the first row when nothing is selected and returns null for no rows", () => {
    expect(moveOrderSelection(orders, null, 1)).toBe("a");
    expect(moveOrderSelection(orders, "gone", -1)).toBe("a");
    expect(moveOrderSelection([], null, 1)).toBeNull();
  });
});
