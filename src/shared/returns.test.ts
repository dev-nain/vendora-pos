import { describe, expect, it } from "vitest";
import { refundCapPaisa, returnMessages } from "./returns";

describe("refundCapPaisa", () => {
  it("takes the smallest of the three amounts", () => {
    expect(
      refundCapPaisa({ availablePaisa: 500, linkedRefundPaisa: 300, netRefundPaisa: 900 }),
    ).toBe(300);
    expect(
      refundCapPaisa({ availablePaisa: 500, linkedRefundPaisa: 800, netRefundPaisa: 200 }),
    ).toBe(200);
  });

  it("never goes below zero", () => {
    expect(
      refundCapPaisa({ availablePaisa: -5, linkedRefundPaisa: 800, netRefundPaisa: 200 }),
    ).toBe(0);
  });
});

describe("returnMessages", () => {
  it("words the quantity and amount messages", () => {
    expect(returnMessages.overSold(2000, "piece")).toBe("Only 2 left to return.");
    expect(returnMessages.overSold(850, "kg")).toBe("Only 0.850 kg left to return.");
    expect(returnMessages.overCap("Card", 12050)).toBe("Card can refund up to Rs 120.50.");
    expect(returnMessages.refundExact(10000)).toBe("Refund exactly Rs 100.");
  });
});
