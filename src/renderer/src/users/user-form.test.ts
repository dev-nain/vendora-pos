import { describe, expect, it } from "vitest";
import { validateCreateUserForm, validateCredentialForm, validateDisplayName } from "./user-form";

const valid = {
  username: "sara",
  displayName: "Sara Khan",
  password: "ab123",
  confirmPassword: "ab123",
  pin: "5555",
  confirmPin: "5555",
};

describe("validateCreateUserForm", () => {
  it("accepts valid values", () => {
    expect(validateCreateUserForm(valid)).toEqual({});
  });

  it("requires username and display name", () => {
    const errors = validateCreateUserForm({ ...valid, username: "  ", displayName: "" });
    expect(errors.username).toBe("Enter a username");
    expect(errors.displayName).toBe("Enter a display name");
  });

  it("enforces password and PIN lengths", () => {
    const errors = validateCreateUserForm({
      ...valid,
      password: "abc",
      confirmPassword: "abc",
      pin: "123",
      confirmPin: "123",
    });
    expect(errors.password).toBe("Password must be 4–5 characters");
    expect(errors.pin).toBe("PIN must be 4–6 digits");
  });

  it("flags mismatched confirmations", () => {
    const errors = validateCreateUserForm({ ...valid, confirmPassword: "x", confirmPin: "1" });
    expect(errors.confirmPassword).toBe("Passwords don't match");
    expect(errors.confirmPin).toBe("PINs don't match");
  });
});

describe("validateDisplayName", () => {
  it("requires a name within 64 characters", () => {
    expect(validateDisplayName("Sara")).toBeUndefined();
    expect(validateDisplayName("")).toBe("Enter a display name");
    expect(validateDisplayName("a".repeat(65))).toBe("Display name must be 64 characters or fewer");
  });
});

describe("validateCredentialForm", () => {
  it("accepts a matching password and PIN", () => {
    expect(validateCredentialForm("password", { value: "ab123", confirm: "ab123" })).toEqual({});
    expect(validateCredentialForm("pin", { value: "7777", confirm: "7777" })).toEqual({});
  });

  it("enforces length rules", () => {
    expect(validateCredentialForm("password", { value: "abc", confirm: "abc" }).value).toBe(
      "Password must be 4–5 characters",
    );
    expect(validateCredentialForm("pin", { value: "12", confirm: "12" }).value).toBe(
      "PIN must be 4–6 digits",
    );
  });

  it("flags a mismatched confirmation", () => {
    expect(validateCredentialForm("password", { value: "ab123", confirm: "ab12" }).confirm).toBe(
      "Passwords don't match",
    );
    expect(validateCredentialForm("pin", { value: "7777", confirm: "7778" }).confirm).toBe(
      "PINs don't match",
    );
  });
});
