import { describe, expect, it } from "vitest";
import {
  authMessages,
  authResultSchema,
  loginInputSchema,
  loginUserSchema,
  pinSwitchInputSchema,
  safeUserSchema,
} from "./auth";

const uuid = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("user views", () => {
  it("reject secret keys", () => {
    const safe = { id: uuid, username: "u", displayName: "U", role: "owner" };
    expect(safeUserSchema.safeParse(safe).success).toBe(true);
    expect(safeUserSchema.safeParse({ ...safe, passwordHash: "x" }).success).toBe(false);
    const tile = { id: uuid, displayName: "U", role: "cashier" };
    expect(loginUserSchema.safeParse(tile).success).toBe(true);
    expect(loginUserSchema.safeParse({ ...tile, pinHash: "x" }).success).toBe(false);
  });
});

describe("input schemas", () => {
  it("trim the username and reject bad input", () => {
    expect(loginInputSchema.parse({ username: "  bob ", password: "x" }).username).toBe("bob");
    expect(loginInputSchema.safeParse({ username: "", password: "x" }).success).toBe(false);
    expect(loginInputSchema.safeParse({ username: "   ", password: "x" }).success).toBe(false);
    expect(loginInputSchema.safeParse({ username: "bob", password: "" }).success).toBe(false);
    expect(loginInputSchema.safeParse({ username: "bob", password: "x", extra: 1 }).success).toBe(
      false,
    );
    expect(pinSwitchInputSchema.safeParse({ userId: "nope", pin: "1234" }).success).toBe(false);
    expect(pinSwitchInputSchema.safeParse({ userId: uuid, pin: "1234", x: 1 }).success).toBe(false);
    expect(pinSwitchInputSchema.safeParse({ userId: uuid, pin: "1234" }).success).toBe(true);
  });
});

describe("authResultSchema", () => {
  it("parses each variant", () => {
    const user = { id: uuid, username: "u", displayName: "U", role: "owner" };
    expect(authResultSchema.safeParse({ ok: true, user }).success).toBe(true);
    expect(
      authResultSchema.safeParse({
        ok: false,
        reason: "invalid-credentials",
        message: authMessages.invalidCredentials,
      }).success,
    ).toBe(true);
    expect(
      authResultSchema.safeParse({
        ok: false,
        reason: "invalid-pin",
        message: authMessages.invalidPin,
      }).success,
    ).toBe(true);
    expect(
      authResultSchema.safeParse({
        ok: false,
        reason: "pin-locked",
        message: authMessages.invalidPin,
        retryAfterMs: 5000,
      }).success,
    ).toBe(true);
    expect(
      authResultSchema.safeParse({ ok: false, reason: "pin-locked", message: "x" }).success,
    ).toBe(false);
  });
});
