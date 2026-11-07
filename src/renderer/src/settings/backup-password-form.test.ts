import { describe, expect, it } from "vitest";
import { validateBackupPasswordForm } from "./backup-password-form";

const values = { current: "", next: "", confirm: "" };

describe("validateBackupPasswordForm", () => {
  it("rejects 7 characters and accepts 8", () => {
    expect(
      validateBackupPasswordForm("turn-on", { ...values, next: "abcdefg", confirm: "abcdefg" }),
    ).toEqual({ next: "Use at least 8 characters." });
    expect(
      validateBackupPasswordForm("turn-on", { ...values, next: "abcdefgh", confirm: "abcdefgh" }),
    ).toEqual({});
  });

  it("accepts a password of only lowercase letters", () => {
    expect(
      validateBackupPasswordForm("turn-on", {
        ...values,
        next: "lowercaseonly",
        confirm: "lowercaseonly",
      }),
    ).toEqual({});
  });

  it("flags a mismatch on the confirm field", () => {
    expect(
      validateBackupPasswordForm("turn-on", { ...values, next: "abcdefgh", confirm: "abcdefgx" }),
    ).toEqual({ confirm: "Passwords don't match." });
  });

  it("needs the current password to change or turn off", () => {
    expect(
      validateBackupPasswordForm("change", { current: "", next: "abcdefgh", confirm: "abcdefgh" }),
    ).toEqual({ current: "Enter the current password." });
    expect(validateBackupPasswordForm("turn-off", values)).toEqual({
      current: "Enter the current password.",
    });
    expect(validateBackupPasswordForm("turn-off", { ...values, current: "x" })).toEqual({});
  });

  it("does not ask for a new password when turning off", () => {
    expect(validateBackupPasswordForm("turn-off", { ...values, current: "x", next: "a" })).toEqual(
      {},
    );
  });
});
