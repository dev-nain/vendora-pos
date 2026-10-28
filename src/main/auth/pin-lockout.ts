import type { users } from "../db/schema";
import { verifyCredential } from "./credentials";

export const PIN_FAILURES_BEFORE_COOLDOWN = 5;
export const PIN_BASE_COOLDOWN_MS = 30_000;
export const PIN_MAX_COOLDOWN_MS = 900_000;

export type PinLockState = Pick<typeof users.$inferSelect, "failedPinAttempts" | "pinRetryAfter">;

export type PinLockStatus = { locked: false } | { locked: true; retryAfterMs: number };

export type PinAttemptResult =
  | { outcome: "ok"; state: PinLockState }
  | { outcome: "wrong"; state: PinLockState }
  | { outcome: "locked"; retryAfterMs: number; state: PinLockState };

export function pinCooldownMs(failures: number): number {
  if (failures < PIN_FAILURES_BEFORE_COOLDOWN) return 0;
  const exponent = Math.min(failures - PIN_FAILURES_BEFORE_COOLDOWN, 10);
  return Math.min(PIN_BASE_COOLDOWN_MS * 2 ** exponent, PIN_MAX_COOLDOWN_MS);
}

export function pinLockStatus(state: PinLockState, now: Date): PinLockStatus {
  if (state.pinRetryAfter === null) return { locked: false };
  const retryAfterMs = state.pinRetryAfter.getTime() - now.getTime();
  // A remaining wait above the cap means the clock moved backwards.
  if (retryAfterMs <= 0 || retryAfterMs > PIN_MAX_COOLDOWN_MS) return { locked: false };
  return { locked: true, retryAfterMs };
}

export function recordPinFailure(state: PinLockState, now: Date): PinLockState {
  const failedPinAttempts = state.failedPinAttempts + 1;
  const cooldown = pinCooldownMs(failedPinAttempts);
  return {
    failedPinAttempts,
    pinRetryAfter: cooldown > 0 ? new Date(now.getTime() + cooldown) : null,
  };
}

export function recordPinSuccess(): PinLockState {
  return { failedPinAttempts: 0, pinRetryAfter: null };
}

export async function attemptPin(
  state: PinLockState,
  pinHash: string,
  pin: string,
  now: Date,
): Promise<PinAttemptResult> {
  const status = pinLockStatus(state, now);
  if (status.locked) return { outcome: "locked", retryAfterMs: status.retryAfterMs, state };
  if (await verifyCredential(pinHash, pin)) return { outcome: "ok", state: recordPinSuccess() };
  return { outcome: "wrong", state: recordPinFailure(state, now) };
}
