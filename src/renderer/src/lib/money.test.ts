import { describe, expect, it } from "vitest";
import { formatRupees, parseRupees } from "./money";

describe("formatRupees", () => {
  it.each([
    [0, "Rs 0"],
    [100, "Rs 1"],
    [125000, "Rs 1,250"],
    [125000000, "Rs 1,250,000"],
    [72763, "Rs 727.63"],
    [16050, "Rs 160.50"],
    [505, "Rs 5.05"],
  ])("formats %i paisa as %s", (paisa, expected) => {
    expect(formatRupees(paisa)).toBe(expected);
  });

  it("rejects fractional paisa", () => {
    expect(() => formatRupees(1.5)).toThrow();
  });
});

describe("parseRupees", () => {
  it.each([
    ["12.5", 1250],
    ["0.05", 5],
    ["12", 1200],
    [" 1250.00 ", 125000],
    ["0", 0],
    ["9999999999999.99", 999999999999999],
  ])("parses %j as %i paisa", (text, paisa) => {
    expect(parseRupees(text)).toEqual({ ok: true, paisa });
  });

  it.each(["", "1.234", "-1", ".5", "12.", "1e3", "Rs 5", "1,000", "abc", "12345678901234"])(
    "rejects %j",
    (text) => {
      expect(parseRupees(text)).toEqual({ ok: false });
    },
  );
});
