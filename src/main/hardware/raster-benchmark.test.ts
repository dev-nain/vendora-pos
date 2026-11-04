import { describe, expect, it } from "vitest";
import { ditherToMono } from "./dither";
import { receiptJob } from "./escpos";

describe("raster benchmark", () => {
  it("dithers and encodes a 576 x 4000 receipt in under 200 ms", () => {
    const widthPx = 576;
    const heightPx = 4000;
    const bitmap = new Uint8Array(widthPx * heightPx * 4);
    for (let i = 0; i < bitmap.length; i += 4) {
      const shade = (i / 4) % 251;
      bitmap.set([shade, shade, shade, 255], i);
    }

    const start = performance.now();
    const bits = ditherToMono(bitmap, widthPx, heightPx, "bgra");
    const job = receiptJob({ widthPx, heightPx, bits });
    const elapsed = performance.now() - start;

    expect(job.length).toBeGreaterThan(bits.length);
    expect(elapsed).toBeLessThan(200);
  });
});
