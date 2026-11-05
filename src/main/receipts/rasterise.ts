import { nativeImage } from "electron";
import type { ReceiptModel } from "../../shared/receipt";
import { ditherToMono } from "../hardware/dither";
import type { MonoImage } from "../hardware/escpos";
import type { RenderWindow } from "./render-window";

export interface Rasterised {
  image: MonoImage;
  previewPng?: Buffer;
}

export type Rasterise = (model: ReceiptModel) => Promise<Rasterised>;

function previewOf(image: MonoImage): Buffer {
  const rowBytes = image.widthPx / 8;
  const bgra = Buffer.alloc(image.widthPx * image.heightPx * 4, 0xff);
  for (let y = 0; y < image.heightPx; y++) {
    for (let x = 0; x < image.widthPx; x++) {
      const black = ((image.bits[y * rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1) === 1;
      if (black) bgra.fill(0, (y * image.widthPx + x) * 4, (y * image.widthPx + x) * 4 + 3);
    }
  }
  return nativeImage
    .createFromBitmap(bgra, { width: image.widthPx, height: image.heightPx })
    .toPNG();
}

export function createRasteriser(renderWindow: RenderWindow, withPreview: boolean): Rasterise {
  return async (model) => {
    const captured = await renderWindow.capture(model);
    const bits = ditherToMono(captured.bitmap, captured.widthPx, captured.heightPx, "bgra");
    const image: MonoImage = { widthPx: captured.widthPx, heightPx: captured.heightPx, bits };
    return withPreview ? { image, previewPng: previewOf(image) } : { image };
  };
}
