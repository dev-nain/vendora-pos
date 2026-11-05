import { describe, expect, it } from "vitest";
import {
  addCashMoveInputSchema,
  closeShiftInputSchema,
  denominationTotalPaisa,
  expectedCashPaisa,
  isVarianceWarning,
  openShiftInputSchema,
  variancePaisa,
} from "./shifts";

const id1 = "0190a000-0000-7000-8000-000000000001";
const id2 = "0190a000-0000-7000-8000-000000000002";

describe("expectedCashPaisa", () => {
  it("is float plus cash in minus cash out", () => {
    expect(
      expectedCashPaisa({ openingFloatPaisa: 500000, cashInPaisa: 50000, cashOutPaisa: 20000 }),
    ).toBe(530000);
  });

  it("can be negative", () => {
    expect(expectedCashPaisa({ openingFloatPaisa: 1000, cashInPaisa: 0, cashOutPaisa: 5000 })).toBe(
      -4000,
    );
  });

  it("throws on floats and unsafe integers", () => {
    expect(() =>
      expectedCashPaisa({ openingFloatPaisa: 1.5, cashInPaisa: 0, cashOutPaisa: 0 }),
    ).toThrow();
    expect(() =>
      expectedCashPaisa({
        openingFloatPaisa: Number.MAX_SAFE_INTEGER + 1,
        cashInPaisa: 0,
        cashOutPaisa: 0,
      }),
    ).toThrow();
  });
});

describe("denominationTotalPaisa", () => {
  it("totals a mixed count", () => {
    expect(
      denominationTotalPaisa([
        { valuePaisa: 100000, count: 5 },
        { valuePaisa: 500, count: 3 },
      ]),
    ).toBe(501500);
  });

  it("is 0 for an empty count", () => {
    expect(denominationTotalPaisa([])).toBe(0);
  });

  it("throws on a fractional count", () => {
    expect(() => denominationTotalPaisa([{ valuePaisa: 100, count: 0.5 }])).toThrow();
  });
});

describe("variancePaisa", () => {
  it("is counted minus expected", () => {
    expect(variancePaisa(520000, 530000)).toBe(-10000);
    expect(variancePaisa(540000, 530000)).toBe(10000);
    expect(variancePaisa(530000, 530000)).toBe(0);
  });
});

describe("isVarianceWarning", () => {
  it("warns on any difference at threshold 0 and never on none", () => {
    expect(isVarianceWarning(1, 0)).toBe(true);
    expect(isVarianceWarning(-1, 0)).toBe(true);
    expect(isVarianceWarning(0, 0)).toBe(false);
  });

  it("warns only above the threshold", () => {
    expect(isVarianceWarning(-15000, 15000)).toBe(false);
    expect(isVarianceWarning(-15001, 15000)).toBe(true);
    expect(isVarianceWarning(15001, 15000)).toBe(true);
  });
});

describe("shift input schemas", () => {
  it("rejects a fractional or negative float and unknown keys", () => {
    expect(openShiftInputSchema.safeParse({ openingFloatPaisa: 1.5 }).success).toBe(false);
    expect(openShiftInputSchema.safeParse({ openingFloatPaisa: -1 }).success).toBe(false);
    expect(openShiftInputSchema.safeParse({ openingFloatPaisa: 0, extra: 1 }).success).toBe(false);
    expect(openShiftInputSchema.safeParse({ openingFloatPaisa: 0 }).success).toBe(true);
  });

  it("rejects a bad cash move", () => {
    const ok = { kind: "in", amountPaisa: 500, reason: "Change" };
    expect(addCashMoveInputSchema.safeParse(ok).success).toBe(true);
    expect(addCashMoveInputSchema.safeParse({ ...ok, amountPaisa: 0 }).success).toBe(false);
    expect(addCashMoveInputSchema.safeParse({ ...ok, amountPaisa: 1.5 }).success).toBe(false);
    expect(addCashMoveInputSchema.safeParse({ ...ok, amountPaisa: -5 }).success).toBe(false);
    expect(addCashMoveInputSchema.safeParse({ ...ok, reason: "   " }).success).toBe(false);
    expect(addCashMoveInputSchema.safeParse({ ...ok, reason: "x".repeat(121) }).success).toBe(
      false,
    );
    expect(addCashMoveInputSchema.safeParse({ ...ok, kind: "sideways" }).success).toBe(false);
    expect(addCashMoveInputSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });

  it("rejects duplicate denomination ids and bad counts on close", () => {
    const base = { shiftId: id1 };
    const lines = (l: { denominationId: string; count: number }[]) => ({
      ...base,
      count: { method: "denominations", lines: l },
    });
    expect(
      closeShiftInputSchema.safeParse(lines([{ denominationId: id2, count: 3 }])).success,
    ).toBe(true);
    expect(
      closeShiftInputSchema.safeParse(
        lines([
          { denominationId: id2, count: 3 },
          { denominationId: id2, count: 1 },
        ]),
      ).success,
    ).toBe(false);
    expect(
      closeShiftInputSchema.safeParse(lines([{ denominationId: id2, count: -1 }])).success,
    ).toBe(false);
    expect(
      closeShiftInputSchema.safeParse(lines([{ denominationId: id2, count: 1.5 }])).success,
    ).toBe(false);
    expect(
      closeShiftInputSchema.safeParse({
        ...base,
        count: { method: "total", countedCashPaisa: -1 },
      }).success,
    ).toBe(false);
    expect(
      closeShiftInputSchema.safeParse({
        ...base,
        count: { method: "total", countedCashPaisa: 100 },
        extra: true,
      }).success,
    ).toBe(false);
  });
});
