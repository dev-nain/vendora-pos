import { randomBytes, randomInt } from "node:crypto";

let lastMs = 0;
let counter = 0;

// rand_a is a counter so ids from the same millisecond stay ordered; on overflow or a
// backwards clock the last timestamp is advanced instead of reused.
export function uuidv7(): string {
  const now = Date.now();
  if (now > lastMs) {
    lastMs = now;
    counter = randomInt(0, 2048);
  } else {
    counter += 1;
    if (counter > 0xfff) {
      lastMs += 1;
      counter = randomInt(0, 2048);
    }
  }

  const bytes = randomBytes(16);
  bytes.writeUIntBE(lastMs, 0, 6);
  bytes[6] = 0x70 | (counter >> 8);
  bytes[7] = counter & 0xff;
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
