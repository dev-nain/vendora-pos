import { describe, expect, it } from "vitest";
import { columnCount, gridHeight, pagesForRange, scrollTopFor, visibleRange } from "./grid-window";

const base = { rowHeight: 108, columns: 3, overscanRows: 2 };

describe("columnCount", () => {
  it("fits as many minimum-width tiles as the width allows", () => {
    expect(columnCount(552, 168, 12)).toBe(3);
    expect(columnCount(528, 168, 12)).toBe(3);
    expect(columnCount(527, 168, 12)).toBe(2);
    expect(columnCount(100, 168, 12)).toBe(1);
    expect(columnCount(0, 168, 12)).toBe(1);
  });
});

describe("gridHeight", () => {
  it("covers every row without a trailing gap", () => {
    expect(gridHeight(0, 3, 108, 12)).toBe(0);
    expect(gridHeight(1, 3, 108, 12)).toBe(96);
    expect(gridHeight(7, 3, 108, 12)).toBe(3 * 108 - 12);
  });
});

describe("visibleRange", () => {
  it("is empty without items", () => {
    expect(visibleRange({ ...base, scrollTop: 0, viewportHeight: 400, total: 0 })).toEqual({
      start: 0,
      end: 0,
    });
  });

  it("starts at the top with overscan below", () => {
    expect(visibleRange({ ...base, scrollTop: 0, viewportHeight: 400, total: 30_000 })).toEqual({
      start: 0,
      end: 18,
    });
  });

  it("windows the middle of a long list on row boundaries", () => {
    const range = visibleRange({ ...base, scrollTop: 10_800, viewportHeight: 432, total: 30_000 });
    expect(range.start).toBe(98 * 3);
    expect(range.end).toBe((100 + 4 + 2 + 1) * 3);
    expect(range.start % 3).toBe(0);
  });

  it("clamps at the last item", () => {
    const range = visibleRange({ ...base, scrollTop: 100_000, viewportHeight: 400, total: 10 });
    expect(range.end).toBe(10);
    expect(range.start).toBeLessThanOrEqual(9);
  });

  it("renders a small bounded number of tiles for a huge list", () => {
    const range = visibleRange({ ...base, scrollTop: 500_000, viewportHeight: 600, total: 30_000 });
    expect(range.end - range.start).toBeLessThan(40);
  });
});

describe("pagesForRange", () => {
  it("lists the pages a range touches", () => {
    expect(pagesForRange({ start: 0, end: 18 }, 100)).toEqual([0]);
    expect(pagesForRange({ start: 90, end: 210 }, 100)).toEqual([0, 1, 2]);
    expect(pagesForRange({ start: 100, end: 200 }, 100)).toEqual([1]);
    expect(pagesForRange({ start: 0, end: 0 }, 100)).toEqual([]);
  });
});

describe("scrollTopFor", () => {
  const layout = { rowHeight: 108, columns: 3, gap: 12 };

  it("keeps the scroll position when the row is visible", () => {
    expect(scrollTopFor(4, { scrollTop: 0, viewportHeight: 400 }, layout)).toBe(0);
  });

  it("scrolls up to a row above the viewport", () => {
    expect(scrollTopFor(0, { scrollTop: 300, viewportHeight: 400 }, layout)).toBe(0);
  });

  it("scrolls down to a row below the viewport", () => {
    expect(scrollTopFor(30, { scrollTop: 0, viewportHeight: 400 }, layout)).toBe(
      10 * 108 + 96 - 400,
    );
  });
});
