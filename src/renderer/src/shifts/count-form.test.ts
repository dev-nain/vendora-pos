import { describe, expect, it } from "vitest";
import { denominationTotalPaisa, type Denomination } from "@shared/shifts";
import { liveCountedPaisa, parseCountForm, type CountFormValues } from "./count-form";

const shiftId = "0190a000-0000-7000-8000-0000000000aa";
const thousand = "0190a000-0000-7000-8000-000000000001";
const hundred = "0190a000-0000-7000-8000-000000000002";
const five = "0190a000-0000-7000-8000-000000000003";

const denominations: Denomination[] = [
  { id: thousand, valuePaisa: 100000, kind: "note" },
  { id: hundred, valuePaisa: 10000, kind: "note" },
  { id: five, valuePaisa: 500, kind: "coin" },
];

const values = (patch: Partial<CountFormValues> = {}): CountFormValues => ({
  mode: "denominations",
  counts: {},
  totalText: "",
  note: "",
  ...patch,
});

describe("parseCountForm", () => {
  it("treats blank counts as 0 and drops zero lines", () => {
    const result = parseCountForm(shiftId, denominations, values({ counts: { [thousand]: "5" } }));

    expect(result).toEqual({
      ok: true,
      input: {
        shiftId,
        count: { method: "denominations", lines: [{ denominationId: thousand, count: 5 }] },
      },
    });
  });

  it("builds an empty denominations count when everything is blank", () => {
    expect(parseCountForm(shiftId, denominations, values())).toMatchObject({
      ok: true,
      input: { count: { method: "denominations", lines: [] } },
    });
  });

  it.each(["1.5", "-1", "abc", "100001", "1e3"])("rejects the count %j", (text) => {
    const result = parseCountForm(shiftId, denominations, values({ counts: { [hundred]: text } }));

    expect(result).toEqual({
      ok: false,
      errors: { counts: { [hundred]: "Whole number, 0 to 100,000" } },
    });
  });

  it("accepts 100000", () => {
    expect(
      parseCountForm(shiftId, denominations, values({ counts: { [five]: "100000" } })).ok,
    ).toBe(true);
  });

  it("builds a total-only input and a trimmed note", () => {
    expect(
      parseCountForm(
        shiftId,
        denominations,
        values({ mode: "total", totalText: "5300.50", note: " short " }),
      ),
    ).toEqual({
      ok: true,
      input: {
        shiftId,
        count: { method: "total", countedCashPaisa: 530050 },
        note: "short",
      },
    });
  });

  it("rejects a bad total", () => {
    const result = parseCountForm(
      shiftId,
      denominations,
      values({ mode: "total", totalText: "abc" }),
    );

    expect(result).toEqual({
      ok: false,
      errors: { counts: {}, total: "Enter an amount like 5000 or 5000.50" },
    });
  });
});

describe("liveCountedPaisa", () => {
  it("matches denominationTotalPaisa", () => {
    const counts = { [thousand]: "5", [hundred]: "2", [five]: "3" };

    expect(liveCountedPaisa(denominations, values({ counts }))).toBe(
      denominationTotalPaisa([
        { valuePaisa: 100000, count: 5 },
        { valuePaisa: 10000, count: 2 },
        { valuePaisa: 500, count: 3 },
      ]),
    );
  });

  it("is null while a count is invalid and 0 for a blank total", () => {
    expect(liveCountedPaisa(denominations, values({ counts: { [five]: "x" } }))).toBeNull();
    expect(liveCountedPaisa(denominations, values({ mode: "total" }))).toBe(0);
  });
});
