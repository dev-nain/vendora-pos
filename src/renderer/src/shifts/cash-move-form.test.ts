import { describe, expect, it } from "vitest";
import { parseCashMoveForm } from "./cash-move-form";

describe("parseCashMoveForm", () => {
  it("parses whole and fractional rupees into paisa and trims the reason", () => {
    expect(parseCashMoveForm("in", "500", "  Change from bank ")).toEqual({
      ok: true,
      input: { kind: "in", amountPaisa: 50000, reason: "Change from bank" },
    });
    expect(parseCashMoveForm("out", "500.50", "Tea")).toEqual({
      ok: true,
      input: { kind: "out", amountPaisa: 50050, reason: "Tea" },
    });
  });

  it("rejects zero", () => {
    expect(parseCashMoveForm("in", "0", "x")).toEqual({
      ok: false,
      errors: { amount: "Enter an amount above 0" },
    });
  });

  it.each(["", "abc", "1.234", "-5"])("rejects the amount %j", (text) => {
    const result = parseCashMoveForm("in", text, "x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.amount).toBe("Enter an amount like 500 or 500.50");
  });

  it("rejects a blank reason", () => {
    expect(parseCashMoveForm("in", "10", "   ")).toEqual({
      ok: false,
      errors: { reason: "Enter a reason" },
    });
  });

  it("rejects a 121-character reason and accepts 120", () => {
    const tooLong = parseCashMoveForm("in", "10", "x".repeat(121));
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.errors.reason).toBe("Reason must be 120 characters or fewer");
    expect(parseCashMoveForm("in", "10", "x".repeat(120)).ok).toBe(true);
  });

  it("reports both errors together", () => {
    const result = parseCashMoveForm("out", "", "");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(["amount", "reason"]);
  });
});
