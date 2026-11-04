import { describe, expect, it } from "vitest";
import { cut, drawerKick, init, rasterBands, receiptJob } from "./escpos";

const image = (widthPx: number, heightPx: number, fill = 0xff) => ({
  widthPx,
  heightPx,
  bits: new Uint8Array((widthPx / 8) * heightPx).fill(fill),
});

describe("escpos", () => {
  it("encodes init, cut and the drawer kick exactly", () => {
    expect([...init()]).toEqual([0x1b, 0x40]);
    expect([...cut()]).toEqual([0x1b, 0x64, 4, 0x1d, 0x56, 0x42, 0x00]);
    expect([...drawerKick()]).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });

  it.each([
    [384, 48],
    [576, 72],
  ])("writes a GS v 0 header for %i px with xL %i", (widthPx, xL) => {
    const [band] = rasterBands(image(widthPx, 10));

    expect([...band!.subarray(0, 8)]).toEqual([0x1d, 0x76, 0x30, 0x00, xL, 0, 10, 0]);
    expect(band).toHaveLength(8 + xL * 10);
  });

  it("splits a tall image into bands of at most 128 rows with the right heights", () => {
    const bits = new Uint8Array(48 * 300);
    bits.set([0xaa], 48 * 128);
    bits.set([0xbb], 48 * 256);

    const bands = rasterBands({ widthPx: 384, heightPx: 300, bits });

    expect(bands.map((b) => b[6]! + (b[7]! << 8))).toEqual([128, 128, 44]);
    expect(bands[1]![8]).toBe(0xaa);
    expect(bands[2]![8]).toBe(0xbb);
  });

  it("builds a job as init, bands and cut", () => {
    const job = receiptJob(image(384, 130));

    expect([...job.subarray(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...job.subarray(-7)]).toEqual([0x1b, 0x64, 4, 0x1d, 0x56, 0x42, 0x00]);
    expect(job).toHaveLength(2 + (8 + 48 * 128) + (8 + 48 * 2) + 7);
  });

  it("rejects a width that is not a multiple of 8 and data of the wrong size", () => {
    expect(() => rasterBands(image(380, 1))).toThrow();
    expect(() => rasterBands({ widthPx: 384, heightPx: 2, bits: new Uint8Array(48) })).toThrow();
  });

  it("makes no bands for an empty image", () => {
    expect(rasterBands(image(384, 0))).toEqual([]);
  });
});
