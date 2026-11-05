import { describe, expect, it } from "vitest";
import { quantityGuardMessage } from "./quantity-guard";

const soap = {
  name: "Lux Soap",
  unit: "piece",
  packQtyMilli: 1000,
  unitPricePaisa: 15000,
} as const;
const rice = {
  name: "Basmati Rice",
  unit: "kg",
  packQtyMilli: 1000,
  unitPricePaisa: 85000,
} as const;

describe("quantityGuardMessage", () => {
  it("passes pieces below 100", () => {
    expect(quantityGuardMessage({ ...soap, qtyMilli: 99_000 })).toBeNull();
  });

  it("asks at 100 pieces and names the total", () => {
    expect(quantityGuardMessage({ ...soap, qtyMilli: 100_000 })).toBe(
      "Set quantity to 100 × Lux Soap (Rs 15,000)?",
    );
  });

  it("passes weights below 25 kg", () => {
    expect(quantityGuardMessage({ ...rice, qtyMilli: 24_999 })).toBeNull();
  });

  it("asks at 25 kg", () => {
    expect(quantityGuardMessage({ ...rice, qtyMilli: 25_000 })).toBe(
      "Set quantity to 25.000 kg × Basmati Rice (Rs 21,250)?",
    );
  });

  it("counts a kg pack line in packs", () => {
    const pack = { ...rice, packQtyMilli: 5000, unitPricePaisa: 400000 };
    expect(quantityGuardMessage({ ...pack, qtyMilli: 30_000 })).toBeNull();
    expect(quantityGuardMessage({ ...pack, qtyMilli: 100_000 })).toBe(
      "Set quantity to 100 × Basmati Rice (Rs 400,000)?",
    );
  });
});
