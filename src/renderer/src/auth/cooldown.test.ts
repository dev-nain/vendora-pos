import { describe, expect, it } from "vitest";
import { formatCooldown, remainingMs } from "./cooldown";

describe("formatCooldown", () => {
  it.each([
    [30_000, "0:30"],
    [29_001, "0:30"],
    [1, "0:01"],
    [0, "0:00"],
    [-5, "0:00"],
    [900_000, "15:00"],
    [61_000, "1:01"],
  ])("formats %i ms as %s", (ms, text) => {
    expect(formatCooldown(ms)).toBe(text);
  });
});

describe("remainingMs", () => {
  it("returns the time left and clamps at zero", () => {
    expect(remainingMs(10_000, 4_000)).toBe(6_000);
    expect(remainingMs(10_000, 10_000)).toBe(0);
    expect(remainingMs(10_000, 12_000)).toBe(0);
  });
});
