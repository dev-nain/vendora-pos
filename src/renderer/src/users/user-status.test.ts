import { describe, expect, it } from "vitest";
import { userStatusLabels } from "./user-status";

describe("userStatusLabels", () => {
  it("labels an active user", () => {
    expect(userStatusLabels({ isActive: true, pinLocked: false })).toEqual(["Active"]);
  });

  it("labels an inactive user", () => {
    expect(userStatusLabels({ isActive: false, pinLocked: false })).toEqual(["Inactive"]);
  });

  it("adds PIN locked for an active user in cooldown", () => {
    expect(userStatusLabels({ isActive: true, pinLocked: true })).toEqual(["Active", "PIN locked"]);
  });

  it("does not flag PIN locked on an inactive user", () => {
    expect(userStatusLabels({ isActive: false, pinLocked: true })).toEqual(["Inactive"]);
  });
});
