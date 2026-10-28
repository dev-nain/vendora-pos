import { describe, expect, it, vi } from "vitest";
import { hashCredential, verifyCredential } from "./credentials";
import {
  attemptPin,
  pinCooldownMs,
  pinLockStatus,
  recordPinFailure,
  recordPinSuccess,
  type PinLockState,
} from "./pin-lockout";

vi.mock("./credentials", { spy: true });

const t0 = new Date("2026-01-01T10:00:00.000Z");
const at = (ms: number) => new Date(t0.getTime() + ms);
const fresh: PinLockState = { failedPinAttempts: 0, pinRetryAfter: null };

const fail = (state: PinLockState, now: Date, times: number) => {
  let current = state;
  for (let i = 0; i < times; i++) current = recordPinFailure(current, now);
  return current;
};

describe("pinCooldownMs", () => {
  it.each([
    [0, 0],
    [1, 0],
    [4, 0],
    [5, 30_000],
    [6, 60_000],
    [7, 120_000],
    [8, 240_000],
    [9, 480_000],
    [10, 900_000],
    [11, 900_000],
    [1_000_000, 900_000],
  ])("failures %i -> %i ms", (failures, expected) => {
    expect(pinCooldownMs(failures)).toBe(expected);
  });
});

describe("cooldown sequence", () => {
  it("starts the cooldown on the fifth failure", () => {
    expect(fail(fresh, t0, 4)).toEqual({ failedPinAttempts: 4, pinRetryAfter: null });
    expect(fail(fresh, t0, 5)).toEqual({ failedPinAttempts: 5, pinRetryAfter: at(30_000) });
  });

  it("reports the remaining wait and unlocks at the deadline", () => {
    const locked = fail(fresh, t0, 5);
    expect(pinLockStatus(locked, at(10_000))).toEqual({ locked: true, retryAfterMs: 20_000 });
    expect(pinLockStatus(locked, at(30_000))).toEqual({ locked: false });
  });

  it("doubles the cooldown on the sixth failure", () => {
    const sixth = recordPinFailure(fail(fresh, t0, 5), at(30_000));
    expect(sixth).toEqual({ failedPinAttempts: 6, pinRetryAfter: at(90_000) });
  });

  it("ignores a deadline far in the future after the clock moved back", () => {
    const state = { failedPinAttempts: 5, pinRetryAfter: at(16 * 60_000) };
    expect(pinLockStatus(state, t0)).toEqual({ locked: false });
  });

  it("resets on success and never mutates input", () => {
    expect(recordPinSuccess()).toEqual(fresh);
    const frozen = Object.freeze({ failedPinAttempts: 2, pinRetryAfter: null });
    expect(() => recordPinFailure(frozen, t0)).not.toThrow();
    expect(frozen.failedPinAttempts).toBe(2);
  });
});

describe("attemptPin", () => {
  it("refuses during cooldown without verifying, then accepts after it", async () => {
    const pinHash = await hashCredential("1234");
    vi.mocked(verifyCredential).mockClear();
    const results = [];
    let state = fresh;

    for (let i = 0; i < 5; i++) {
      const result = await attemptPin(state, pinHash, "9999", t0);
      expect(result.outcome).toBe("wrong");
      state = result.state;
      results.push(result);
    }
    expect(state).toEqual({ failedPinAttempts: 5, pinRetryAfter: at(30_000) });
    expect(verifyCredential).toHaveBeenCalledTimes(5);

    const refused = await attemptPin(state, pinHash, "1234", at(10_000));
    expect(refused).toEqual({ outcome: "locked", retryAfterMs: 20_000, state });
    expect(verifyCredential).toHaveBeenCalledTimes(5);
    results.push(refused);

    const accepted = await attemptPin(state, pinHash, "1234", at(30_000));
    expect(accepted).toEqual({ outcome: "ok", state: fresh });
    results.push(accepted);

    const serialized = JSON.stringify(results);
    expect(serialized).not.toContain("1234");
    expect(serialized).not.toContain(pinHash);
  });

  it("resets the counter on a correct PIN before the fifth failure", async () => {
    const pinHash = await hashCredential("1234");
    const result = await attemptPin(
      { failedPinAttempts: 3, pinRetryAfter: null },
      pinHash,
      "1234",
      t0,
    );
    expect(result).toEqual({ outcome: "ok", state: fresh });
  });
});
