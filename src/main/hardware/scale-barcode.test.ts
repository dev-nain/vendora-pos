import { describe, expect, it } from "vitest";
import { ean13CheckDigit, parseScaleBarcode, type ScaleBarcodeConfig } from "./scale-barcode";

const config: ScaleBarcodeConfig = { weightPrefix: "21", pricePrefix: "22" };

const build = (prefix: string, item: string, value: string) => {
  const first12 = `${prefix}${item}${value}`;
  return `${first12}${ean13CheckDigit(first12)}`;
};

describe("ean13CheckDigit", () => {
  it("matches a known EAN-13", () => {
    expect(ean13CheckDigit("400638133393")).toBe(1);
  });
});

describe("parseScaleBarcode", () => {
  it("parses a weight code as milli-units", () => {
    expect(parseScaleBarcode(build("21", "00123", "01234"), config)).toEqual({
      itemCode: "00123",
      kind: "weight",
      qtyMilli: 1234,
    });
  });

  it("parses a price code as paisa", () => {
    expect(parseScaleBarcode(build("22", "00123", "00250"), config)).toEqual({
      itemCode: "00123",
      kind: "price",
      pricePaisa: 25000,
    });
  });

  it("keeps leading zeros in the item code", () => {
    expect(parseScaleBarcode(build("21", "00001", "00500"), config)).toMatchObject({
      itemCode: "00001",
    });
  });

  it("accepts the maximum value", () => {
    expect(parseScaleBarcode(build("21", "12345", "99999"), config)).toMatchObject({
      qtyMilli: 99999,
    });
    expect(parseScaleBarcode(build("22", "12345", "99999"), config)).toMatchObject({
      pricePaisa: 9999900,
    });
  });

  it("honours custom prefixes and rejects the defaults", () => {
    const custom = { weightPrefix: "02", pricePrefix: "29" };
    expect(parseScaleBarcode(build("02", "00123", "01000"), custom)).toMatchObject({
      kind: "weight",
    });
    expect(parseScaleBarcode(build("29", "00123", "01000"), custom)).toMatchObject({
      kind: "price",
    });
    expect(parseScaleBarcode(build("21", "00123", "01000"), custom)).toBeNull();
  });

  it("rejects wrong lengths, non-digits and spaces", () => {
    const valid = build("21", "00123", "01234");
    expect(parseScaleBarcode(valid.slice(0, 12), config)).toBeNull();
    expect(parseScaleBarcode(`${valid}0`, config)).toBeNull();
    expect(parseScaleBarcode(`${valid.slice(0, 12)}x`, config)).toBeNull();
    expect(parseScaleBarcode(`${valid.slice(0, 5)} ${valid.slice(6)}`, config)).toBeNull();
    expect(parseScaleBarcode("", config)).toBeNull();
  });

  it("rejects every wrong check digit", () => {
    const valid = build("21", "00123", "01234");
    for (let d = 0; d <= 9; d++) {
      if (d === Number(valid[12])) continue;
      expect(parseScaleBarcode(`${valid.slice(0, 12)}${d}`, config)).toBeNull();
    }
  });

  it("rejects an unknown prefix", () => {
    expect(parseScaleBarcode(build("20", "00123", "01234"), config)).toBeNull();
  });

  it("rejects a zero value", () => {
    expect(parseScaleBarcode(build("21", "00123", "00000"), config)).toBeNull();
    expect(parseScaleBarcode(build("22", "00123", "00000"), config)).toBeNull();
  });

  it("rejects a config with equal prefixes", () => {
    expect(
      parseScaleBarcode(build("21", "00123", "01234"), { weightPrefix: "21", pricePrefix: "21" }),
    ).toBeNull();
  });
});
