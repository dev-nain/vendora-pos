import { describe, expect, it } from "vitest";
import { passwordSchema, pinSchema } from "./credentials";

describe("passwordSchema", () => {
  it.each(["abcd", "ab 1!", "پاکست"])("accepts %s", (value) => {
    expect(passwordSchema.safeParse(value).success).toBe(true);
  });

  it.each(["", "abc", "abcdef"])("rejects %j", (value) => {
    expect(passwordSchema.safeParse(value).success).toBe(false);
  });

  it("does not echo the input in the error", () => {
    const result = passwordSchema.safeParse("abcdef");
    expect(JSON.stringify(result.error)).not.toContain("abcdef");
  });
});

describe("pinSchema", () => {
  it.each(["0000", "0123", "123456"])("accepts %s", (value) => {
    expect(pinSchema.safeParse(value).success).toBe(true);
  });

  it.each(["123", "1234567", "12a4", " 1234", "１２３４", 1234])("rejects %j", (value) => {
    expect(pinSchema.safeParse(value).success).toBe(false);
  });

  it("does not echo the input in the error", () => {
    const result = pinSchema.safeParse("12a4x");
    expect(JSON.stringify(result.error)).not.toContain("12a4x");
  });
});
