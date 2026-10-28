import { describe, expect, it } from "vitest";
import { ApprovalError, UnauthenticatedError } from "./errors";
import { APPROVAL_TTL_MS, createApprovalStore } from "./approvals";
import { createSessionStore } from "./session";

const requester = "00000000-0000-7000-8000-000000000001";
const approver = "00000000-0000-7000-8000-000000000002";

function setup() {
  let current = new Date("2026-01-01T09:00:00.000Z");
  const sessions = createSessionStore();
  sessions.start({ userId: requester, role: "cashier", storeId: "s", loggedInAt: current });
  const approvals = createApprovalStore({ sessions, now: () => current });
  return {
    sessions,
    approvals,
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
    issue: (action: "drawer.open-no-sale" | "stock.adjust" = "drawer.open-no-sale") =>
      approvals.issueApproval({
        action,
        requestedByUserId: requester,
        approverUserId: approver,
      }),
  };
}

describe("approval store", () => {
  it("returns the approver and requester once, then refuses reuse", () => {
    const { approvals, issue } = setup();
    const token = issue();

    expect(approvals.consumeApproval(token, "drawer.open-no-sale")).toEqual({
      approverUserId: approver,
      requestedByUserId: requester,
    });
    expect(() => approvals.consumeApproval(token, "drawer.open-no-sale")).toThrow(ApprovalError);
  });

  it("accepts a token just before the lifetime ends", () => {
    const { approvals, issue, advance } = setup();
    const token = issue();
    advance(APPROVAL_TTL_MS - 1);

    expect(approvals.consumeApproval(token, "drawer.open-no-sale").approverUserId).toBe(approver);
  });

  it("refuses a token at exactly the lifetime", () => {
    const { approvals, issue, advance } = setup();
    const token = issue();
    advance(APPROVAL_TTL_MS);

    expect(() => approvals.consumeApproval(token, "drawer.open-no-sale")).toThrow(ApprovalError);
  });

  it("refuses a different action and burns the token", () => {
    const { approvals, issue } = setup();
    const token = issue();

    expect(() => approvals.consumeApproval(token, "stock.adjust")).toThrow(ApprovalError);
    expect(() => approvals.consumeApproval(token, "drawer.open-no-sale")).toThrow(ApprovalError);
  });

  it("refuses a different session user", () => {
    const { approvals, issue, sessions } = setup();
    const token = issue();
    sessions.start({
      userId: "00000000-0000-7000-8000-000000000003",
      role: "cashier",
      storeId: "s",
      loggedInAt: new Date(),
    });

    expect(() => approvals.consumeApproval(token, "drawer.open-no-sale")).toThrow(ApprovalError);
  });

  it("throws UnauthenticatedError without a session", () => {
    const { approvals, issue, sessions } = setup();
    const token = issue();
    sessions.end();

    expect(() => approvals.consumeApproval(token, "drawer.open-no-sale")).toThrow(
      UnauthenticatedError,
    );
  });

  it("refuses an unknown token", () => {
    const { approvals } = setup();

    expect(() => approvals.consumeApproval("nope", "drawer.open-no-sale")).toThrow(ApprovalError);
  });

  it("invalidates outstanding tokens on clear", () => {
    const { approvals, issue } = setup();
    const token = issue();
    approvals.clear();

    expect(() => approvals.consumeApproval(token, "drawer.open-no-sale")).toThrow(ApprovalError);
  });
});
