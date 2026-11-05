import { describe, expect, it } from "vitest";
import { isCodeLike, notFoundMessage } from "./scan-input";

describe("isCodeLike", () => {
  it.each(["1234567890128", "ABC-12", "  8961014000011 ", "A1", "12-34"])(
    "reads %j as a code",
    (text) => {
      expect(isCodeLike(text)).toBe(true);
    },
  );

  it.each(["zzz", "tea bag", "lux 2", "dalda-oil", "ABC-", "چائے", "1 2"])(
    "reads %j as text",
    (text) => {
      expect(isCodeLike(text)).toBe(false);
    },
  );
});

describe("notFoundMessage", () => {
  it("names a barcode", () => {
    expect(notFoundMessage("1234567890128")).toBe("Barcode 1234567890128 not found");
    expect(notFoundMessage("ABC-12")).toBe("Barcode ABC-12 not found");
  });

  it("names a search text", () => {
    expect(notFoundMessage("zzz")).toBe("No product matches 'zzz'");
    expect(notFoundMessage(" tea bag ")).toBe("No product matches 'tea bag'");
  });
});
