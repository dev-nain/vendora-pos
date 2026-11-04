import { describe, expect, it } from "vitest";
import { ditherToMono } from "./dither";

const solid = (widthPx: number, heightPx: number, [r, g, b]: [number, number, number]) => {
  const data = new Uint8Array(widthPx * heightPx * 4);
  for (let i = 0; i < data.length; i += 4) data.set([r, g, b, 255], i);
  return data;
};

const blackCount = (bits: Uint8Array) => {
  let total = 0;
  for (const byte of bits) {
    for (let b = byte; b; b >>= 1) total += b & 1;
  }
  return total;
};

describe("ditherToMono", () => {
  it("makes white all zeros and black all ones", () => {
    expect([...ditherToMono(solid(16, 2, [255, 255, 255]), 16, 2, "rgba")]).toEqual([0, 0, 0, 0]);
    expect([...ditherToMono(solid(16, 2, [0, 0, 0]), 16, 2, "rgba")]).toEqual([
      0xff, 0xff, 0xff, 0xff,
    ]);
  });

  it("makes mid grey about half black", () => {
    const bits = ditherToMono(solid(64, 64, [128, 128, 128]), 64, 64, "rgba");

    const share = blackCount(bits) / (64 * 64);
    expect(share).toBeGreaterThan(0.45);
    expect(share).toBeLessThan(0.55);
  });

  it("reads the BGRA and RGBA channel orders the same way", () => {
    const blue = solid(8, 1, [0, 0, 255]);
    const red = solid(8, 1, [255, 0, 0]);

    expect(ditherToMono(blue, 8, 1, "rgba")).toEqual(ditherToMono(red, 8, 1, "bgra"));
    expect(blackCount(ditherToMono(blue, 8, 1, "rgba"))).toBe(8);
    expect(blackCount(ditherToMono(red, 8, 1, "rgba"))).toBe(7);
  });

  it("packs most significant bit first and pads a short row with white", () => {
    const data = solid(10, 1, [255, 255, 255]);
    data.set([0, 0, 0, 255], 0);

    const bits = ditherToMono(data, 10, 1, "rgba");

    expect(bits).toHaveLength(2);
    expect(bits[0]! & 0x80).toBe(0x80);
    expect(bits[1]! & 0x3f).toBe(0);
  });
});
