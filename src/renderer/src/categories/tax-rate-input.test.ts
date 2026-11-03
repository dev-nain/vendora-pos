import { describe, expect, it } from "vitest";

import { formatTaxRate, parseTaxRatePercent, rateInputText } from "./tax-rate-input";

describe("parseTaxRatePercent", () => {
  it.each([
    ["17", 1700],
    ["0.5", 50],
    ["0", 0],
    [" 17.25 ", 1725],
    ["100", 10000],
    ["0.05", 5],
    ["17.5", 1750],
  ])("accepts %j as %i bps", (text, rateBps) => {
    expect(parseTaxRatePercent(text)).toEqual({ ok: true, rateBps });
  });

  it.each(["", "100.01", "101", "1.234", "-1", "5%", ".5", "abc", "1e2"])("rejects %j", (text) => {
    expect(parseTaxRatePercent(text)).toEqual({ ok: false });
  });
});

describe("formatTaxRate", () => {
  it.each([
    [null, "Store rate"],
    [1700, "17%"],
    [50, "0.5%"],
    [1705, "17.05%"],
    [0, "0%"],
  ])("formats %s as %j", (rateBps, text) => {
    expect(formatTaxRate(rateBps)).toBe(text);
  });

  it("prefills the input without a percent sign", () => {
    expect(rateInputText(1750)).toBe("17.5");
  });
});
