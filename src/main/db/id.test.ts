import { afterEach, describe, expect, it, vi } from "vitest";
import { uuidv7 } from "./id";

const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function embeddedMs(id: string): number {
  return Number.parseInt(id.replace(/-/g, "").slice(0, 12), 16);
}

describe("uuidv7", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("matches the UUIDv7 layout", () => {
    for (let i = 0; i < 100; i += 1) expect(uuidv7()).toMatch(UUIDV7);
  });

  it("generates unique, strictly increasing ids in a tight loop", () => {
    const ids = Array.from({ length: 10_000 }, () => uuidv7());
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.toSorted()).toEqual(ids);
  });

  it("embeds the current time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-05-04T10:00:00.000Z"));
    expect(embeddedMs(uuidv7())).toBe(Date.now());
  });

  it("orders ids by the time they were generated", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2032-01-01T00:00:00.000Z"));
    const earlier = uuidv7();
    vi.setSystemTime(new Date("2032-01-01T00:00:01.000Z"));
    const later = uuidv7();
    expect(later > earlier).toBe(true);
  });

  it("stays ordered when the clock moves backwards", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2033-01-01T00:00:10.000Z"));
    const first = uuidv7();
    vi.setSystemTime(new Date("2033-01-01T00:00:05.000Z"));
    const second = uuidv7();
    expect(second > first).toBe(true);
  });
});
