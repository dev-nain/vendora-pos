import { describe, expect, it } from "vitest";
import { appendDigit, digitFromKey, sanitizePin } from "./pin-entry";

describe("sanitizePin", () => {
  it("strips non-digits and caps at six", () => {
    expect(sanitizePin("12a3-4")).toBe("1234");
    expect(sanitizePin("1234567")).toBe("123456");
    expect(sanitizePin("")).toBe("");
  });
});

describe("appendDigit", () => {
  it("stops at six digits", () => {
    expect(appendDigit("12", "3")).toBe("123");
    expect(appendDigit("123456", "7")).toBe("123456");
  });
});

describe("digitFromKey", () => {
  it("maps the number row by key", () => {
    expect(digitFromKey("0", "Digit0")).toBe("0");
    expect(digitFromKey("9", "Digit9")).toBe("9");
  });

  it("maps the numpad by code when NumLock is off", () => {
    expect(digitFromKey("Home", "Numpad7")).toBe("7");
    expect(digitFromKey("Insert", "Numpad0")).toBe("0");
  });

  it("returns null for letters and other keys", () => {
    expect(digitFromKey("a", "KeyA")).toBeNull();
    expect(digitFromKey("Enter", "Enter")).toBeNull();
    expect(digitFromKey("Enter", "NumpadEnter")).toBeNull();
  });
});
