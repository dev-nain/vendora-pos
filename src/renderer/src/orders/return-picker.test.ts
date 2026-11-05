import type { ReturnableLine } from "@shared/returns";
import { describe, expect, it } from "vitest";
import {
  buildReturnLines,
  canRefund,
  invalidQuantityError,
  readQuantity,
  returnQuantityText,
  rowError,
  wholeUnitsError,
} from "./return-picker";

const line = (over: Partial<ReturnableLine> = {}): ReturnableLine => ({
  saleLineId: "a",
  nameEn: "Soap",
  nameUr: null,
  unit: "piece",
  packQtyMilli: 1000,
  unitPricePaisa: 15000,
  isMisc: false,
  soldQtyMilli: 3000,
  refundedQtyMilli: 1000,
  pendingQtyMilli: 0,
  leftQtyMilli: 2000,
  ...over,
});

const weighed = line({
  saleLineId: "w",
  unit: "kg",
  soldQtyMilli: 1250,
  refundedQtyMilli: 0,
  leftQtyMilli: 1250,
});

describe("readQuantity", () => {
  it("reads whole pieces and weighed decimals", () => {
    expect(readQuantity("2", line())).toEqual({ kind: "quantity", milli: 2000 });
    expect(readQuantity("0.4", weighed)).toEqual({ kind: "quantity", milli: 400 });
    expect(readQuantity("1.250", weighed)).toEqual({ kind: "quantity", milli: 1250 });
  });

  it("treats blank and zero as no return", () => {
    expect(readQuantity("", line())).toEqual({ kind: "empty" });
    expect(readQuantity("  ", line())).toEqual({ kind: "empty" });
    expect(readQuantity("0", line())).toEqual({ kind: "empty" });
  });

  it("explains fractions of pieces and packs", () => {
    expect(readQuantity("1.5", line())).toEqual({ kind: "error", message: wholeUnitsError });
    const pack = line({ unit: "kg", packQtyMilli: 5000 });
    expect(readQuantity("1.5", pack)).toEqual({ kind: "error", message: wholeUnitsError });
    expect(readQuantity("abc", line())).toEqual({ kind: "error", message: invalidQuantityError });
  });

  it("refuses more than is left", () => {
    expect(rowError("3", line())).toBe("Only 2 left to return.");
    expect(rowError("1.251", weighed)).toBe("Only 1.250 kg left to return.");
    expect(rowError("2", line())).toBeNull();
  });
});

describe("returnQuantityText", () => {
  it("shows whole units for pieces and packs and decimals for weighed lines", () => {
    expect(returnQuantityText(2000, line())).toBe("2");
    expect(returnQuantityText(1250, weighed)).toBe("1.250 kg");
    expect(returnQuantityText(2000, line({ unit: "kg", packQtyMilli: 5000 }))).toBe("2");
  });
});

describe("canRefund and buildReturnLines", () => {
  const lines = [line(), weighed, line({ saleLineId: "z", leftQtyMilli: 0 })];

  it("needs one quantity and no errors", () => {
    expect(canRefund(lines, {})).toBe(false);
    expect(canRefund(lines, { a: "1" })).toBe(true);
    expect(canRefund(lines, { a: "1", w: "9" })).toBe(false);
    expect(canRefund(lines, { z: "1" })).toBe(false);
  });

  it("lists only the entered quantities", () => {
    expect(buildReturnLines(lines, { a: "2", w: "0.400", z: "" })).toEqual([
      { saleLineId: "a", qtyMilli: 2000 },
      { saleLineId: "w", qtyMilli: 400 },
    ]);
  });
});
