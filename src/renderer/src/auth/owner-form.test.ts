import { describe, expect, it } from "vitest";
import { validateOwnerForm, type OwnerFormValues } from "./owner-form";

const valid: OwnerFormValues = {
  username: "owner1",
  displayName: "Imran Qureshi",
  password: "ab12",
  confirmPassword: "ab12",
  pin: "1234",
  confirmPin: "1234",
};

describe("validateOwnerForm", () => {
  it("returns no errors for valid values", () => {
    expect(validateOwnerForm(valid)).toEqual({});
  });

  it("reports each empty field", () => {
    expect(
      validateOwnerForm({
        username: " ",
        displayName: "",
        password: "",
        confirmPassword: "",
        pin: "",
        confirmPin: "",
      }),
    ).toEqual({
      username: "Enter a username",
      displayName: "Enter a display name",
      password: "Password must be 4–5 characters",
      pin: "PIN must be 4–6 digits",
    });
  });

  it("reports mismatched confirms", () => {
    expect(validateOwnerForm({ ...valid, confirmPassword: "ab13", confirmPin: "1235" })).toEqual({
      confirmPassword: "Passwords don't match",
      confirmPin: "PINs don't match",
    });
  });

  it("reports out-of-range password and PIN", () => {
    expect(
      validateOwnerForm({
        ...valid,
        password: "abcdef",
        confirmPassword: "abcdef",
        pin: "123",
        confirmPin: "123",
      }),
    ).toEqual({
      password: "Password must be 4–5 characters",
      pin: "PIN must be 4–6 digits",
    });
  });

  it("returns errors in field tab order", () => {
    const errors = validateOwnerForm({
      username: "",
      displayName: "",
      password: "ab",
      confirmPassword: "x",
      pin: "1",
      confirmPin: "2",
    });
    expect(Object.keys(errors)).toEqual([
      "username",
      "displayName",
      "password",
      "confirmPassword",
      "pin",
      "confirmPin",
    ]);
  });
});
