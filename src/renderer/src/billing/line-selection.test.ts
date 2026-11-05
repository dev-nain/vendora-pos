import type { Bill, BillLine } from "@shared/checkout";
import { describe, expect, it } from "vitest";
import { moveSelection, selectAfter, selectAfterDelete } from "./line-selection";

const line = (id: string, over: Partial<BillLine> = {}): BillLine => ({
  id,
  position: 0,
  productId: `p-${id}`,
  name: id,
  nameUr: null,
  unit: "piece",
  qtyMilli: 1000,
  packQtyMilli: 1000,
  unitPricePaisa: 100,
  priceType: "original",
  discount: null,
  isReturn: false,
  scaleSource: null,
  isMisc: false,
  grossPaisa: 100,
  lineDiscountPaisa: 0,
  billDiscountPaisa: 0,
  taxRateBps: 0,
  taxPaisa: 0,
  totalPaisa: 100,
  ...over,
});

const bill = (lines: BillLine[], id = "b1"): Bill => ({
  id,
  heldAt: null,
  billDiscount: null,
  lines,
  deletedLineCount: 0,
  totals: { subtotalPaisa: 0, discountPaisa: 0, taxPaisa: 0, roundingPaisa: 0, totalPaisa: 0 },
  pricesIncludeTax: true,
  cashRounding: { mode: "off", unitPaisa: 100 },
});

describe("selectAfter", () => {
  it("selects a newly added line", () => {
    const prev = bill([line("a")]);
    expect(selectAfter(prev, bill([line("a"), line("b")]), "a")).toBe("b");
  });

  it("selects the first line of a new bill", () => {
    expect(selectAfter(null, bill([line("a")]), null)).toBe("a");
  });

  it("selects the merged line whose quantity changed", () => {
    const prev = bill([line("a"), line("b")]);
    const next = bill([line("a", { qtyMilli: 2000 }), line("b")]);
    expect(selectAfter(prev, next, "b")).toBe("a");
  });

  it("selects the line whose price or discount changed", () => {
    const prev = bill([line("a"), line("b")]);
    expect(selectAfter(prev, bill([line("a"), line("b", { unitPricePaisa: 90 })]), "a")).toBe("b");
    const discounted = line("a", { discount: { kind: "percent", bps: 1000 } });
    expect(selectAfter(prev, bill([discounted, line("b")]), "b")).toBe("a");
  });

  it("keeps the current line when nothing changed", () => {
    const same = bill([line("a"), line("b")]);
    expect(selectAfter(same, same, "a")).toBe("a");
  });

  it("falls back to the last line when the current one is gone", () => {
    expect(selectAfter(bill([line("a"), line("b")]), bill([line("a")]), "b")).toBe("a");
  });

  it("returns null for an empty bill", () => {
    expect(selectAfter(bill([line("a")]), bill([]), "a")).toBeNull();
  });

  it("treats a different bill as all new lines", () => {
    const prev = bill([line("a")], "b1");
    expect(selectAfter(prev, bill([line("a"), line("z")], "b2"), "a")).toBe("a");
  });
});

describe("selectAfterDelete", () => {
  const lines = [line("a"), line("b"), line("c")];

  it("selects the line above", () => {
    expect(selectAfterDelete(lines, "b")).toBe("a");
    expect(selectAfterDelete(lines, "c")).toBe("b");
  });

  it("selects the new last line when the first is deleted", () => {
    expect(selectAfterDelete(lines, "a")).toBe("c");
  });

  it("returns null when nothing is left", () => {
    expect(selectAfterDelete([line("a")], "a")).toBeNull();
  });
});

describe("moveSelection", () => {
  const lines = [line("a"), line("b"), line("c")];

  it("moves and clamps at the ends", () => {
    expect(moveSelection(lines, "a", 1)).toBe("b");
    expect(moveSelection(lines, "c", 1)).toBe("c");
    expect(moveSelection(lines, "a", -1)).toBe("a");
  });

  it("starts at an end when nothing is selected", () => {
    expect(moveSelection(lines, null, 1)).toBe("a");
    expect(moveSelection(lines, null, -1)).toBe("c");
  });

  it("returns null for no lines", () => {
    expect(moveSelection([], null, 1)).toBeNull();
  });
});
