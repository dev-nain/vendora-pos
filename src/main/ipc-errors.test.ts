import { describe, expect, it } from "vitest";
import { ipcErrorMessages } from "../shared/ipc";
import { UnauthenticatedError } from "./auth/errors";
import { toIpcError } from "./ipc-errors";

describe("toIpcError", () => {
  it("maps UnauthenticatedError to the safe message", () => {
    const mapped = toIpcError(new UnauthenticatedError());

    expect((mapped as Error).message).toBe(ipcErrorMessages.unauthenticated);
    expect(mapped).not.toBeInstanceOf(UnauthenticatedError);
  });

  it("passes other errors through unchanged", () => {
    const other = new Error("boom");

    expect(toIpcError(other)).toBe(other);
    expect(toIpcError("text")).toBe("text");
  });
});
