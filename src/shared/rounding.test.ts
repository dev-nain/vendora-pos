import { describe, expect, it } from "vitest";
import {
  divRoundHalfUp,
  roundToUnit,
  tenderRoundingPaisa,
  type RoundingSettings,
  type TenderInput,
} from "./rounding";

describe("divRoundHalfUp", () => {
  it("rounds half away from zero", () => {
    expect(divRoundHalfUp(5n, 10n)).toBe(1);
    expect(divRoundHalfUp(-5n, 10n)).toBe(-1);
    expect(divRoundHalfUp(4n, 10n)).toBe(0);
    expect(divRoundHalfUp(-4n, 10n)).toBe(0);
  });

  it("throws past the safe integer range", () => {
    expect(() => divRoundHalfUp(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 1n)).toThrow();
  });
});

describe("roundToUnit", () => {
  it("rounds to the nearest multiple, away from zero on a half", () => {
    expect(roundToUnit(1050, 100)).toBe(1100);
    expect(roundToUnit(1049, 100)).toBe(1000);
    expect(roundToUnit(-1050, 100)).toBe(-1100);
  });
});

describe("tenderRoundingPaisa", () => {
  const cashOnly: RoundingSettings = { mode: "cash-only", unitPaisa: 500 };

  it("is zero when rounding is off", () => {
    const off: RoundingSettings = { mode: "off", unitPaisa: 500 };
    expect(tenderRoundingPaisa(72200, off, [{ method: "cash", amountPaisa: 72200 }])).toBe(0);
  });

  it("rounds the whole bill in every-bill mode", () => {
    const everyBill: RoundingSettings = { mode: "every-bill", unitPaisa: 500 };
    expect(tenderRoundingPaisa(72200, everyBill, undefined)).toBe(-200);
  });

  it("is zero in cash-only mode with no cash tender", () => {
    expect(tenderRoundingPaisa(72200, cashOnly, [{ method: "card", amountPaisa: 72200 }])).toBe(0);
    expect(tenderRoundingPaisa(72200, cashOnly, undefined)).toBe(0);
  });

  it("rounds only the cash share of a split", () => {
    const tenders: TenderInput[] = [
      { method: "cash", amountPaisa: 22200 },
      { method: "card", amountPaisa: 50000 },
    ];
    expect(tenderRoundingPaisa(72200, cashOnly, tenders)).toBe(-200);
  });

  it("is zero when the cash share is zero", () => {
    const tenders: TenderInput[] = [
      { method: "cash", amountPaisa: 100 },
      { method: "card", amountPaisa: 72200 },
    ];
    expect(tenderRoundingPaisa(72200, cashOnly, tenders)).toBe(0);
  });
});
