import { describe, expect, it } from "vitest";

import {
  movementReasonLabels,
  movementTypeLabels,
  onHandText,
  signedQuantityText,
  signedValueText,
} from "./stock-format";

describe("onHandText", () => {
  it("prints whole pieces", () => {
    expect(onHandText(3000, "piece")).toBe("3 pcs");
    expect(onHandText(0, "piece")).toBe("0 pcs");
  });

  it("prints weighed units to 3 decimals", () => {
    expect(onHandText(1875, "kg")).toBe("1.875 kg");
    expect(onHandText(500, "litre")).toBe("0.500 L");
  });

  it("uses the minus sign for negative stock", () => {
    expect(onHandText(-3000, "piece")).toBe("−3 pcs");
    expect(onHandText(-1250, "kg")).toBe("−1.250 kg");
  });
});

describe("signedQuantityText", () => {
  it("adds a plus for positive amounts", () => {
    expect(signedQuantityText(1250, "kg")).toBe("+1.250 kg");
    expect(signedQuantityText(2000, "piece")).toBe("+2 pcs");
    expect(signedQuantityText(125, "litre")).toBe("+0.125 L");
  });

  it("uses the minus sign for negative amounts", () => {
    expect(signedQuantityText(-1250, "kg")).toBe("−1.250 kg");
  });

  it("leaves zero unsigned", () => {
    expect(signedQuantityText(0, "kg")).toBe("0.000 kg");
  });
});

describe("signedValueText", () => {
  it("adds a plus for positive values", () => {
    expect(signedValueText(17000)).toBe("+Rs 170");
    expect(signedValueText(1)).toBe("+Rs 0.01");
  });

  it("uses the minus sign for negative values", () => {
    expect(signedValueText(-10750)).toBe("−Rs 107.50");
    expect(signedValueText(-98800)).toBe("−Rs 988");
  });

  it("leaves zero unsigned", () => {
    expect(signedValueText(0)).toBe("Rs 0");
  });
});

describe("labels", () => {
  it("names every movement type", () => {
    expect(movementTypeLabels).toEqual({
      opening: "Opening",
      sale: "Sale",
      return: "Return",
      receipt: "Receipt",
      adjustment: "Adjustment",
      stocktake: "Stocktake",
      damage: "Damage",
    });
  });

  it("names every reason", () => {
    expect(movementReasonLabels).toEqual({
      damage: "Damage",
      expiry: "Expiry",
      theft: "Theft",
      correction: "Correction",
    });
  });
});
