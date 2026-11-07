import { describe, expect, it } from "vitest";
import { emptyCountMessage, packHint, readCountEntry } from "./stocktake-input";

describe("readCountEntry", () => {
  it.each(["", "  ", "12"])("treats %j as unchanged when it matches or is empty", (text) => {
    expect(readCountEntry(text, "12", "piece")).toEqual({ kind: "unchanged" });
  });

  it("reads a whole number of pieces in milli-units", () => {
    expect(readCountEntry("12", "", "piece")).toEqual({ kind: "valid", countedMilli: 12000 });
    expect(readCountEntry("0", "", "piece")).toEqual({ kind: "valid", countedMilli: 0 });
    expect(readCountEntry("13", "12", "piece")).toEqual({ kind: "valid", countedMilli: 13000 });
  });

  it("reads up to three decimals for kg and litre", () => {
    expect(readCountEntry("1.25", "", "kg")).toEqual({ kind: "valid", countedMilli: 1250 });
    expect(readCountEntry("0.001", "", "litre")).toEqual({ kind: "valid", countedMilli: 1 });
  });

  it.each(["1.5", "-1", "abc", "1,5"])("rejects %j for pieces", (text) => {
    expect(readCountEntry(text, "", "piece")).toEqual({
      kind: "invalid",
      message: "Enter a whole number, 0 or more.",
    });
  });

  it.each(["1.2345", "-0.5", "x"])("rejects %j for kg", (text) => {
    expect(readCountEntry(text, "", "kg")).toEqual({
      kind: "invalid",
      message: "Enter 0 or more, up to 3 decimals.",
    });
  });

  it("accepts the maximum and rejects anything above it", () => {
    expect(readCountEntry("1000000", "", "piece")).toEqual({
      kind: "valid",
      countedMilli: 1_000_000_000,
    });
    expect(readCountEntry("1000001", "", "piece")).toMatchObject({ kind: "invalid" });
    expect(readCountEntry("1000000.001", "", "kg")).toMatchObject({ kind: "invalid" });
  });

  it("gives the unit's message for an empty count", () => {
    expect(emptyCountMessage("piece")).toBe("Enter a whole number, 0 or more.");
    expect(emptyCountMessage("litre")).toBe("Enter 0 or more, up to 3 decimals.");
  });
});

describe("packHint", () => {
  it("is null for a single unit", () => {
    expect(packHint(1000, "piece")).toBeNull();
  });

  it("names the pack size and the unit to count in", () => {
    expect(packHint(12000, "piece")).toBe("Pack of 12 scanned. Enter the count in pieces.");
    expect(packHint(2500, "kg")).toBe("Pack of 2.5 scanned. Enter the count in kg.");
  });
});
