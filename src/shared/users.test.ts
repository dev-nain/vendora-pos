import { describe, expect, it } from "vitest";
import {
  createUserInputSchema,
  managedUserSchema,
  resetPasswordInputSchema,
  resetPinInputSchema,
  updateUserInputSchema,
  userIdInputSchema,
} from "./users";

const id = "0190a3b4-7c5d-7e8f-9a0b-1c2d3e4f5a6b";

const validCreate = {
  username: "sara",
  displayName: "Sara Khan",
  password: "ab123",
  pin: "5555",
};

describe("users input schemas", () => {
  it("accepts valid inputs", () => {
    expect(createUserInputSchema.safeParse(validCreate).success).toBe(true);
    expect(updateUserInputSchema.safeParse({ id, displayName: "Sara" }).success).toBe(true);
    expect(resetPasswordInputSchema.safeParse({ id, password: "abcd" }).success).toBe(true);
    expect(resetPinInputSchema.safeParse({ id, pin: "123456" }).success).toBe(true);
    expect(userIdInputSchema.safeParse({ id }).success).toBe(true);
  });

  it("rejects extra keys", () => {
    expect(createUserInputSchema.safeParse({ ...validCreate, isActive: true }).success).toBe(false);
    expect(createUserInputSchema.safeParse({ ...validCreate, role: "owner" }).success).toBe(false);
    expect(updateUserInputSchema.safeParse({ id, displayName: "S", role: "cashier" }).success).toBe(
      false,
    );
    expect(updateUserInputSchema.safeParse({ id, displayName: "S", username: "x" }).success).toBe(
      false,
    );
    expect(resetPasswordInputSchema.safeParse({ id, password: "abcd", extra: 1 }).success).toBe(
      false,
    );
    expect(resetPinInputSchema.safeParse({ id, pin: "1234", extra: 1 }).success).toBe(false);
    expect(userIdInputSchema.safeParse({ id, extra: 1 }).success).toBe(false);
  });

  it("rejects a bad uuid", () => {
    expect(userIdInputSchema.safeParse({ id: "nope" }).success).toBe(false);
    expect(updateUserInputSchema.safeParse({ id: "1", displayName: "S" }).success).toBe(false);
    expect(resetPasswordInputSchema.safeParse({ id: "1", password: "abcd" }).success).toBe(false);
    expect(resetPinInputSchema.safeParse({ id: "1", pin: "1234" }).success).toBe(false);
  });

  it("rejects 3- or 6-character passwords", () => {
    expect(createUserInputSchema.safeParse({ ...validCreate, password: "abc" }).success).toBe(
      false,
    );
    expect(createUserInputSchema.safeParse({ ...validCreate, password: "abcdef" }).success).toBe(
      false,
    );
    expect(resetPasswordInputSchema.safeParse({ id, password: "abc" }).success).toBe(false);
    expect(resetPasswordInputSchema.safeParse({ id, password: "abcdef" }).success).toBe(false);
  });

  it("rejects short or alphabetic PINs", () => {
    expect(createUserInputSchema.safeParse({ ...validCreate, pin: "123" }).success).toBe(false);
    expect(createUserInputSchema.safeParse({ ...validCreate, pin: "12ab" }).success).toBe(false);
    expect(resetPinInputSchema.safeParse({ id, pin: "123" }).success).toBe(false);
    expect(resetPinInputSchema.safeParse({ id, pin: "abcd" }).success).toBe(false);
  });
});

describe("managedUserSchema", () => {
  const user = {
    id,
    username: "sara",
    displayName: "Sara",
    isActive: true,
    pinLocked: false,
  };

  it("accepts a managed user", () => {
    expect(managedUserSchema.safeParse(user).success).toBe(true);
  });

  it("rejects a role key", () => {
    expect(managedUserSchema.safeParse({ ...user, role: "manager" }).success).toBe(false);
  });

  it("rejects a password hash", () => {
    expect(managedUserSchema.safeParse({ ...user, passwordHash: "x" }).success).toBe(false);
  });
});
