import { describe, expect, it } from "vitest";
import { formatRupees } from "./money";

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
