import { describe, expect, it } from "vitest";
import {
  changeFor,
  offeredReasons,
  parseSignedQuantityMilli,
  toAdjustmentInput,
  type StockAdjustForm,
} from "./stock-adjust";

const ID = "01890000-0000-7000-8000-000000000000";
const form = (patch: Partial<StockAdjustForm>): StockAdjustForm => ({
  mode: "change",
  quantity: "",
  reason: null,
  ...patch,
});

describe("parseSignedQuantityMilli", () => {
  it("reads signs and unsigned numbers", () => {
    expect(parseSignedQuantityMilli("+5", "piece")).toEqual({ ok: true, milli: 5000 });
    expect(parseSignedQuantityMilli("-5", "piece")).toEqual({ ok: true, milli: -5000 });
    expect(parseSignedQuantityMilli("−5", "piece")).toEqual({ ok: true, milli: -5000 });
    expect(parseSignedQuantityMilli("5", "piece")).toEqual({ ok: true, milli: 5000 });
    expect(parseSignedQuantityMilli("-1.250", "kg")).toEqual({ ok: true, milli: -1250 });
  });

  it("refuses bad text", () => {
    for (const text of ["1.5", "--1", "-", ""]) {
      expect(parseSignedQuantityMilli(text, "piece")).toEqual({ ok: false });
    }
  });

  it("never returns negative zero", () => {
    const result = parseSignedQuantityMilli("-0", "piece");
    expect(result.ok && Object.is(result.milli, 0)).toBe(true);
  });
});

const error = (f: StockAdjustForm, unit: "piece" | "kg" = "piece", onHand = 5000) => {
  const result = changeFor(f, onHand, unit);
  return result.ok ? null : result.error;
};

describe("changeFor", () => {
  it("explains each problem", () => {
    expect(error(form({}))).toBe("Enter a quantity");
    expect(error(form({ mode: "count" }))).toBe("Enter the counted quantity");
    expect(error(form({ quantity: "x" }))).toBe("Enter a whole number");
    expect(error(form({ quantity: "x" }), "kg")).toBe("Enter a number with up to 3 decimals");
    expect(error(form({ quantity: "+1.5" }))).toBe("Enter a whole number");
    expect(error(form({ mode: "count", quantity: "+3" }))).toBe("Enter a whole number");
    expect(error(form({ quantity: "2000000" }))).toBe("That quantity is too large");
    expect(error(form({ quantity: "0" }))).toBe("Enter a quantity other than zero");
    expect(error(form({ mode: "count", quantity: "5" }))).toBe(
      "That matches on hand. Nothing to save.",
    );
  });

  it("computes the change in change mode", () => {
    expect(changeFor(form({ quantity: "-2" }), 5000, "piece")).toEqual({
      ok: true,
      changeMilli: -2000,
      newOnHandMilli: 3000,
    });
    expect(changeFor(form({ quantity: "9" }), -1000, "piece")).toEqual({
      ok: true,
      changeMilli: 9000,
      newOnHandMilli: 8000,
    });
  });

  it("computes the difference in count mode", () => {
    expect(changeFor(form({ mode: "count", quantity: "8" }), 5000, "piece")).toEqual({
      ok: true,
      changeMilli: 3000,
      newOnHandMilli: 8000,
    });
    expect(changeFor(form({ mode: "count", quantity: "1.5" }), 5000, "kg")).toEqual({
      ok: true,
      changeMilli: -3500,
      newOnHandMilli: 1500,
    });
    expect(changeFor(form({ mode: "count", quantity: "0" }), -2000, "piece")).toEqual({
      ok: true,
      changeMilli: 2000,
      newOnHandMilli: 0,
    });
  });
});

describe("offeredReasons", () => {
  it("offers only correction for a positive change", () => {
    expect(offeredReasons(1000)).toEqual(["correction"]);
  });

  it("offers every reason otherwise", () => {
    const all = ["damage", "expiry", "theft", "correction"];
    expect(offeredReasons(-1000)).toEqual(all);
    expect(offeredReasons(0)).toEqual(all);
    expect(offeredReasons(null)).toEqual(all);
  });
});

describe("toAdjustmentInput", () => {
  it("builds both modes", () => {
    expect(toAdjustmentInput(form({ quantity: "-2", reason: "theft" }), ID, "piece")).toEqual({
      mode: "change",
      productId: ID,
      qtyMilli: -2000,
      reason: "theft",
    });
    expect(
      toAdjustmentInput(form({ mode: "count", quantity: "4.5", reason: "correction" }), ID, "kg"),
    ).toEqual({ mode: "count", productId: ID, countedMilli: 4500, reason: "correction" });
  });

  it("returns null without a reason or a valid quantity", () => {
    expect(toAdjustmentInput(form({ quantity: "-2" }), ID, "piece")).toBeNull();
    expect(toAdjustmentInput(form({ quantity: "x", reason: "theft" }), ID, "piece")).toBeNull();
  });
});
