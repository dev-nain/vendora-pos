import { describe, expect, it } from "vitest";
import {
  authMessages,
  authResultSchema,
  createOwnerInputSchema,
  createOwnerResultSchema,
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

describe("createOwnerInputSchema", () => {
  const valid = { username: "owner1", displayName: "Imran", password: "ab12", pin: "1234" };
  const parse = (patch: object) => createOwnerInputSchema.safeParse({ ...valid, ...patch });

  it("trims the username and display name", () => {
    const result = parse({ username: "  owner1 ", displayName: " Imran Qureshi " });
    expect(result.success && result.data).toMatchObject({
      username: "owner1",
      displayName: "Imran Qureshi",
    });
  });

  it("rejects empty, blank and over-long names", () => {
    for (const key of ["username", "displayName"]) {
      expect(parse({ [key]: "" }).success).toBe(false);
      expect(parse({ [key]: "   " }).success).toBe(false);
      expect(parse({ [key]: "a".repeat(65) }).success).toBe(false);
      expect(parse({ [key]: "a".repeat(64) }).success).toBe(true);
    }
  });

  it("enforces password length 4-5", () => {
    expect(parse({ password: "abc" }).success).toBe(false);
    expect(parse({ password: "abcdef" }).success).toBe(false);
    expect(parse({ password: "abcd" }).success).toBe(true);
    expect(parse({ password: "abcde" }).success).toBe(true);
  });

  it("enforces PIN of 4-6 digits", () => {
    for (const pin of ["123", "1234567", "12a4"]) expect(parse({ pin }).success).toBe(false);
    for (const pin of ["1234", "123456"]) expect(parse({ pin }).success).toBe(true);
  });

  it("rejects unknown keys", () => {
    expect(parse({ role: "owner" }).success).toBe(false);
    expect(parse({ passwordConfirm: "ab12" }).success).toBe(false);
  });
});

describe("createOwnerResultSchema", () => {
  it("rejects a user carrying a hash", () => {
    const user = { id: uuid, username: "u", displayName: "U", role: "owner" };
    expect(createOwnerResultSchema.safeParse({ ok: true, user }).success).toBe(true);
    expect(
      createOwnerResultSchema.safeParse({ ok: true, user: { ...user, passwordHash: "x" } }).success,
    ).toBe(false);
  });
});
