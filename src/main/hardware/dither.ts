export function ditherToMono(
  bitmap: Uint8Array,
  widthPx: number,
  heightPx: number,
  order: "bgra" | "rgba",
): Uint8Array {
  const rowBytes = Math.ceil(widthPx / 8);
  const out = new Uint8Array(rowBytes * heightPx);
  const redAt = order === "bgra" ? 2 : 0;
  const blueAt = order === "bgra" ? 0 : 2;
  let current = new Int32Array(widthPx + 2);
  let next = new Int32Array(widthPx + 2);

  for (let y = 0; y < heightPx; y++) {
    const rowStart = y * widthPx * 4;
    for (let x = 0; x < widthPx; x++) {
      const at = rowStart + x * 4;
      const luminance =
        (299 * bitmap[at + redAt]! + 587 * bitmap[at + 1]! + 114 * bitmap[at + blueAt]!) / 1000;
      const wanted = Math.min(255, Math.max(0, Math.round(luminance) + current[x + 1]!));
      const black = wanted < 128;
      const error = wanted - (black ? 0 : 255);
      if (black) out[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
      current[x + 2]! += (error * 7) >> 4;
      next[x]! += (error * 3) >> 4;
      next[x + 1]! += (error * 5) >> 4;
      next[x + 2]! += error >> 4;
    }
    const done = current;
    current = next;
    next = done;
    next.fill(0);
  }
  return out;
}
