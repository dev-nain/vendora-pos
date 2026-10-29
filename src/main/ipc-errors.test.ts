import { describe, expect, it } from "vitest";
import { ipcErrorMessages } from "../shared/ipc";
import {
  ApprovalError,
  ForbiddenError,
  SessionLockedError,
  UnauthenticatedError,
} from "./auth/errors";
import { toIpcError } from "./ipc-errors";

describe("toIpcError", () => {
  it("maps ForbiddenError to the safe message", () => {
    const mapped = toIpcError(new ForbiddenError("stock.manage"));

    expect(mapped).toBeInstanceOf(Error);
    expect((mapped as Error).message).toBe(ipcErrorMessages.forbidden);
    expect((mapped as Error).message).not.toContain("stock.manage");
    expect(mapped).not.toBeInstanceOf(ForbiddenError);
  });

  it("maps UnauthenticatedError to the safe message", () => {
    const mapped = toIpcError(new UnauthenticatedError());

    expect((mapped as Error).message).toBe(ipcErrorMessages.unauthenticated);
    expect(mapped).not.toBeInstanceOf(UnauthenticatedError);
  });

  it("maps SessionLockedError to the safe message", () => {
    const mapped = toIpcError(new SessionLockedError());

    expect((mapped as Error).message).toBe(ipcErrorMessages.locked);
    expect(mapped).not.toBeInstanceOf(SessionLockedError);
  });

  it("maps ApprovalError to the safe message", () => {
    const mapped = toIpcError(new ApprovalError());

    expect((mapped as Error).message).toBe(ipcErrorMessages.approvalInvalid);
    expect(mapped).not.toBeInstanceOf(ApprovalError);
  });

  it("passes other errors through unchanged", () => {
    const other = new Error("boom");

    expect(toIpcError(other)).toBe(other);
    expect(toIpcError("text")).toBe("text");
  });
});
