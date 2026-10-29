import { describe, expect, it } from "vitest";
import { parseAutoLockMinutes } from "./auto-lock-input";

describe("parseAutoLockMinutes", () => {
  it.each([
    ["1", 1],
    ["5", 5],
    [" 60 ", 60],
    ["07", 7],
  ])("accepts %j", (text, minutes) => {
    expect(parseAutoLockMinutes(text)).toEqual({ ok: true, minutes });
  });

  it.each(["", "  ", "0", "61", "100", "1.5", "-1", "5m", "abc", "1e1", "00"])(
    "rejects %j",
    (text) => {
      expect(parseAutoLockMinutes(text)).toEqual({ ok: false });
    },
  );
});
