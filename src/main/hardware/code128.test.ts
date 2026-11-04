import { describe, expect, it } from "vitest";
import { code128Modules } from "./code128";

const runs = (modules: boolean[]) => {
  const out: number[] = [];
  let last: boolean | null = null;
  for (const bar of modules) {
    if (bar === last) out[out.length - 1]! += 1;
    else out.push(1);
    last = bar;
  }
  return out;
};

const body = (text: string) => runs(code128Modules(text).slice(10, -10));

describe("code128Modules", () => {
  it("wraps start, data, checksum and stop in a 10 module quiet zone each side", () => {
    const result = code128Modules("A");

    expect(result.slice(0, 10).every((m) => !m)).toBe(true);
    expect(result.slice(-10).every((m) => !m)).toBe(true);
    expect(result).toHaveLength(10 + 11 * 3 + 13 + 10);
    expect(result[10]).toBe(true);
  });

  it("encodes A as start B, A, checksum 34 and stop", () => {
    expect(body("A")).toEqual([
      2, 1, 1, 2, 1, 4, 1, 1, 1, 3, 2, 3, 1, 3, 1, 1, 2, 3, 2, 3, 3, 1, 1, 1, 2,
    ]);
  });

  it("sizes a real invoice number with one start, one checksum and one stop", () => {
    const text = "T1-000231";
    const values = [...text].map((c) => c.charCodeAt(0) - 32);
    const checksum = (104 + values.reduce((sum, v, i) => sum + v * (i + 1), 0)) % 103;

    expect(checksum).toBe(76);
    expect(body(text)).toHaveLength(6 * (1 + text.length + 1) + 7);
    expect(code128Modules(text)).toHaveLength(10 + 11 * (1 + text.length + 1) + 13 + 10);
  });

  it("gives every printable character one distinct 11 module symbol", () => {
    const seen = new Set<string>();
    for (let code = 32; code <= 126; code++) {
      const text = String.fromCharCode(code);
      expect(code128Modules(text)).toHaveLength(10 + 11 * 3 + 13 + 10);
      seen.add(body(text).slice(6, 12).join(""));
    }
    expect(seen.size).toBe(95);
  });

  it("throws outside ASCII 32 to 126", () => {
    expect(() => code128Modules("é")).toThrow();
    expect(() => code128Modules("a\nb")).toThrow();
    expect(() => code128Modules("ا")).toThrow();
  });
});
