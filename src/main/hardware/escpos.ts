export interface MonoImage {
  widthPx: number;
  heightPx: number;
  bits: Uint8Array;
}

const maxBandRows = 128;

export function init(): Uint8Array {
  return Uint8Array.of(0x1b, 0x40);
}

export function cut(): Uint8Array {
  return Uint8Array.of(0x1b, 0x64, 4, 0x1d, 0x56, 66, 0);
}

export function drawerKick(): Uint8Array {
  return Uint8Array.of(0x1b, 0x70, 0x00, 0x19, 0xfa);
}

export function rasterBands(image: MonoImage): Uint8Array[] {
  const xBytes = image.widthPx / 8;
  if (!Number.isInteger(xBytes) || xBytes < 1 || xBytes > 0xffff) {
    throw new Error("Raster width must be a multiple of 8 pixels");
  }
  if (image.bits.length !== xBytes * image.heightPx) {
    throw new Error("Raster data does not match its size");
  }
  const bands: Uint8Array[] = [];
  for (let top = 0; top < image.heightPx; top += maxBandRows) {
    const rows = Math.min(maxBandRows, image.heightPx - top);
    const band = new Uint8Array(8 + xBytes * rows);
    band.set([0x1d, 0x76, 0x30, 0x00, xBytes & 0xff, xBytes >> 8, rows & 0xff, rows >> 8]);
    band.set(image.bits.subarray(top * xBytes, (top + rows) * xBytes), 8);
    bands.push(band);
  }
  return bands;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function receiptJob(image: MonoImage): Uint8Array {
  return concatBytes([init(), ...rasterBands(image), cut()]);
}
