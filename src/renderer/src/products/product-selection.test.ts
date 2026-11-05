import { describe, expect, it } from "vitest";
import type { ProductSearchItem } from "@shared/products";
import { pageState, setPage, toggleOne } from "./product-selection";

const item = (n: number): ProductSearchItem => ({
  id: `id-${n}`,
  nameEn: `Item ${n}`,
  nameUr: null,
  internalCode: null,
  categoryId: "c",
  unit: "piece",
  salePricePaisa: 100,
  isActive: true,
  primaryBarcode: null,
  extraBarcodeCount: 0,
  onHandMilli: 0,
});

const page = [item(1), item(2), item(3)];

describe("toggleOne", () => {
  it("adds then removes an item", () => {
    const added = toggleOne(new Map(), page[0]!);
    expect([...added.selection.keys()]).toEqual(["id-1"]);
    expect(toggleOne(added.selection, page[0]!).selection.size).toBe(0);
  });

  it("refuses to add past the limit but still removes", () => {
    const full = toggleOne(new Map([["id-1", page[0]!]]), page[1]!, 1);
    expect(full.capped).toBe(true);
    expect(full.selection.size).toBe(1);
    expect(toggleOne(full.selection, page[0]!, 1).selection.size).toBe(0);
  });
});

describe("setPage", () => {
  it("selects and deselects every row on the page", () => {
    const all = setPage(new Map(), page, true);
    expect(all.selection.size).toBe(3);
    expect(setPage(all.selection, page, false).selection.size).toBe(0);
  });

  it("keeps selections from other pages", () => {
    const other = new Map([["id-9", item(9)]]);
    const selected = setPage(other, page, true).selection;
    expect(setPage(selected, page, false).selection.has("id-9")).toBe(true);
  });

  it("stops at the limit and reports it", () => {
    const result = setPage(new Map(), page, true, 2);
    expect(result.selection.size).toBe(2);
    expect(result.capped).toBe(true);
    expect(setPage(new Map(), page, true, 3).capped).toBe(false);
  });
});

describe("pageState", () => {
  it("reports none, some and all", () => {
    expect(pageState(new Map(), page)).toBe("none");
    expect(pageState(new Map([["id-1", page[0]!]]), page)).toBe("some");
    expect(pageState(setPage(new Map(), page, true).selection, page)).toBe("all");
  });

  it("is none for an empty page", () => {
    expect(pageState(new Map(), [])).toBe("none");
  });
});
