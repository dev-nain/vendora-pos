import { describe, expect, it } from "vitest";
import { auditActions, auditRecordInputSchema } from "./audit";

const actor = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const approver = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";

describe("auditRecordInputSchema", () => {
  it("accepts each Core action", () => {
    for (const action of auditActions) {
      const input =
        action === "override"
          ? { action, actorUserId: actor, approverUserId: approver }
          : { action, actorUserId: actor };
      expect(auditRecordInputSchema.safeParse(input).success).toBe(true);
    }
    expect(auditActions).toHaveLength(12);
  });

  it("rejects an unknown action", () => {
    expect(auditRecordInputSchema.safeParse({ action: "hack", actorUserId: actor }).success).toBe(
      false,
    );
  });

  it("rejects an override without an approver", () => {
    expect(
      auditRecordInputSchema.safeParse({ action: "override", actorUserId: actor }).success,
    ).toBe(false);
  });

  it("rejects keys the service owns", () => {
    for (const extra of [{ storeId: "x" }, { createdAt: new Date() }, { id: "x" }]) {
      expect(
        auditRecordInputSchema.safeParse({ action: "login", actorUserId: actor, ...extra }).success,
      ).toBe(false);
    }
  });

  it.each([
    { password: "x" },
    { pin: "1" },
    { pinHash: "x" },
    { passwordHash: "x" },
    { licenseKey: "x" },
    { PIN: "1" },
    { pin_hash: "x" },
    { "license-key": "x" },
    { user: { passwordHash: "x" } },
    { items: [{ pin: "1" }] },
  ])("rejects forbidden details %j", (details) => {
    const result = auditRecordInputSchema.safeParse({
      action: "login",
      actorUserId: actor,
      details,
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain('"x"');
  });

  it("accepts look-alike keys", () => {
    expect(
      auditRecordInputSchema.safeParse({
        action: "login",
        actorUserId: actor,
        details: { pinRetryAfter: 1, spinCount: 2 },
      }).success,
    ).toBe(true);
  });
});
