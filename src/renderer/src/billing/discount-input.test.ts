import { describe, expect, it } from "vitest";
import { discountInputText, parseDiscountInput, toggleDiscountKind } from "./discount-input";

describe("parseDiscountInput", () => {
  it("parses a percentage into basis points", () => {
    expect(parseDiscountInput("10", "percent")).toEqual({
      ok: true,
      discount: { kind: "percent", bps: 1000 },
    });
    expect(parseDiscountInput("12.5", "percent")).toEqual({
      ok: true,
      discount: { kind: "percent", bps: 1250 },
    });
  });

  it("parses rupees into paisa", () => {
    expect(parseDiscountInput("20", "amount")).toEqual({
      ok: true,
      discount: { kind: "amount", amountPaisa: 2000 },
    });
    expect(parseDiscountInput("20.50", "amount")).toEqual({
      ok: true,
      discount: { kind: "amount", amountPaisa: 2050 },
    });
  });

  it("clears the discount on empty text or zero", () => {
    expect(parseDiscountInput("", "percent")).toEqual({ ok: true, discount: null });
    expect(parseDiscountInput("  ", "amount")).toEqual({ ok: true, discount: null });
    expect(parseDiscountInput("0", "percent")).toEqual({ ok: true, discount: null });
    expect(parseDiscountInput("0.00", "amount")).toEqual({ ok: true, discount: null });
  });

  it("rejects over 100 percent and malformed text", () => {
    expect(parseDiscountInput("100.01", "percent").ok).toBe(false);
    expect(parseDiscountInput("101", "percent").ok).toBe(false);
    expect(parseDiscountInput("abc", "amount").ok).toBe(false);
    expect(parseDiscountInput("-5", "percent").ok).toBe(false);
  });

  it("accepts exactly 100 percent", () => {
    expect(parseDiscountInput("100", "percent")).toEqual({
      ok: true,
      discount: { kind: "percent", bps: 10000 },
    });
  });
});

describe("discountInputText", () => {
  it("writes the current value for editing", () => {
    expect(discountInputText(null)).toBe("");
    expect(discountInputText({ kind: "percent", bps: 1050 })).toBe("10.5");
    expect(discountInputText({ kind: "amount", amountPaisa: 2000 })).toBe("20");
  });
});

describe("toggleDiscountKind", () => {
  it("switches between percent and rupees", () => {
    expect(toggleDiscountKind("percent")).toBe("amount");
    expect(toggleDiscountKind("amount")).toBe("percent");
  });
});
