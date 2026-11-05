import { describe, expect, it } from "vitest";
import { weightPreview, weightTotalPaisa } from "./weight-total";

describe("weightTotalPaisa", () => {
  it.each([
    [412, 85000, 35020],
    [1000, 85000, 85000],
    [1, 85000, 85],
    [1, 400, 0],
    [1, 500, 1],
    [30000, 85000, 2_550_000],
  ])("prices %i milli at %i paisa as %i", (qty, price, total) => {
    expect(weightTotalPaisa(qty, price)).toBe(total);
  });
});

describe("weightPreview", () => {
  it("shows the live total", () => {
    expect(weightPreview("0.412", "kg", 85000)).toEqual({
      ok: true,
      qtyMilli: 412,
      totalPaisa: 35020,
      text: "0.412 kg × Rs 850 = Rs 350.20",
    });
  });

  it("uses litres", () => {
    expect(weightPreview("2", "litre", 20000)).toMatchObject({
      text: "2.000 L × Rs 200 = Rs 400",
    });
  });

  it.each(["", "0", "0.000", "abc", "1.2345", "-1"])("rejects %j", (text) => {
    expect(weightPreview(text, "kg", 85000)).toEqual({ ok: false });
  });
});
