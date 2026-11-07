import { describe, expect, it } from "vitest";
import type { AuditCursor } from "@shared/audit";
import {
  dateRangeError,
  emptyAuditFilters,
  newerPage,
  olderPage,
  pageRangeText,
  queryFor,
} from "./audit-paging";

const cursor = (n: number): AuditCursor => ({
  createdAt: `2026-01-0${n}T00:00:00.000Z`,
  id: `0192f3a0-0000-7000-8000-00000000000${n}`,
});

describe("audit paging", () => {
  it("pushes the next cursor and pops going back", () => {
    const one = olderPage([], cursor(1));
    const two = olderPage(one, cursor(2));
    expect(two).toEqual([cursor(1), cursor(2)]);
    expect(newerPage(two)).toEqual([cursor(1)]);
    expect(newerPage([])).toEqual([]);
  });

  it("does nothing on a null cursor", () => {
    const stack = [cursor(1)];
    expect(olderPage(stack, null)).toBe(stack);
  });

  it("describes the shown range", () => {
    expect(pageRangeText(0, 50)).toBe("Showing 1–50");
    expect(pageRangeText(2, 50)).toBe("Showing 101–150");
    expect(pageRangeText(2, 7)).toBe("Showing 101–107");
    expect(pageRangeText(0, 0)).toBe("No entries");
  });

  it("leaves empty filters out and sets before from the top of the stack", () => {
    expect(queryFor(emptyAuditFilters, [])).toEqual({});
    expect(
      queryFor({ userId: "u", action: "login", from: "2026-01-01", to: "" }, [
        cursor(1),
        cursor(2),
      ]),
    ).toEqual({ userId: "u", action: "login", from: "2026-01-01", before: cursor(2) });
  });

  it("drops an unknown action", () => {
    expect(queryFor({ ...emptyAuditFilters, action: "void" }, [])).toEqual({});
  });

  it("reports a reversed date range only", () => {
    expect(dateRangeError("2026-02-01", "2026-01-01")).toBe("From must not be after To.");
    expect(dateRangeError("2026-01-01", "2026-01-01")).toBeNull();
    expect(dateRangeError("2026-01-01", "")).toBeNull();
    expect(dateRangeError("", "")).toBeNull();
  });
});
