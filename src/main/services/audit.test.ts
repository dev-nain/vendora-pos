import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VendoraDatabase } from "../db/client";
import { auditLog, stores, terminals, users } from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import * as auditModule from "./audit";
import { auditActions, auditRecordInputSchema, createAuditService } from "./audit";
import { openMigratedDatabase } from "../db/test-database";

const actor = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

const newUser = (username: string) => ({
  username,
  displayName: "Name",
  passwordHash: "hash",
  pinHash: "hash",
});

describe("createAuditService", () => {
  let dir: string;
  let database: VendoraDatabase;
  let audit: ReturnType<typeof createAuditService>;
  let ownerId: string;
  let managerId: string;

  const rows = () => database.db.select().from(auditLog).all();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-audit-"));
    database = openMigratedDatabase(join(dir, "vendora.db"));
    seedStoreAndTerminal(database);
    ownerId = database.db.insert(users).values(newUser("owner")).returning().get().id;
    managerId = database.db.insert(users).values(newUser("manager")).returning().get().id;
    audit = createAuditService(database);
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes one row with the store, terminal, actor and a UUIDv7 id", () => {
    const id = audit.record({ action: "login", actorUserId: ownerId });

    const all = rows();
    expect(all).toHaveLength(1);
    const row = all[0];
    expect(row?.id).toBe(id);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(row?.storeId).toBe(database.db.select().from(stores).get()?.id);
    expect(row?.terminalId).toBe(database.db.select().from(terminals).get()?.id);
    expect(row?.action).toBe("login");
    expect(row?.actorUserId).toBe(ownerId);
    expect(Math.abs((row?.createdAt.getTime() ?? 0) - Date.now())).toBeLessThan(5000);
  });

  it("writes nothing for invalid input", () => {
    expect(() =>
      audit.record({
        action: "override",
        actorUserId: ownerId,
      } as unknown as auditModule.AuditRecordInput),
    ).toThrow();
    expect(() =>
      audit.record({
        action: "login",
        actorUserId: ownerId,
        approverUserId: managerId,
      } as unknown as auditModule.AuditRecordInput),
    ).toThrow();
    expect(() =>
      audit.record({ action: "login", actorUserId: ownerId, details: { pin: "1" } }),
    ).toThrow();
    expect(() =>
      audit.record({
        action: "nope",
        actorUserId: ownerId,
      } as unknown as auditModule.AuditRecordInput),
    ).toThrow();
    expect(rows()).toHaveLength(0);
  });

  it("rejects an unknown actor at the database level", () => {
    expect(() => audit.record({ action: "login", actorUserId: actor })).toThrow();
    expect(rows()).toHaveLength(0);
  });

  it("stores details as JSON and omitted fields as NULL", () => {
    audit.record({
      action: "price_change",
      actorUserId: ownerId,
      entityType: "product",
      entityId: "abc",
      details: { from: 100, to: 120, tags: ["a"] },
    });
    audit.record({ action: "logout", actorUserId: ownerId });

    const [first, second] = rows();
    expect(JSON.parse(first?.details ?? "")).toEqual({ from: 100, to: 120, tags: ["a"] });
    expect(first?.entityType).toBe("product");
    expect(first?.entityId).toBe("abc");
    expect(second?.details).toBeNull();
    expect(second?.entityType).toBeNull();
    expect(second?.entityId).toBeNull();
  });

  it("leaves no row when the transaction rolls back", () => {
    expect(() =>
      database.db.transaction((tx) => {
        audit.record({ action: "void", actorUserId: ownerId }, tx);
        tx.rollback();
      }),
    ).toThrow();
    expect(rows()).toHaveLength(0);
  });

  it("keeps the row when the transaction commits", () => {
    database.db.transaction((tx) => {
      audit.record({ action: "void", actorUserId: ownerId }, tx);
    });
    expect(rows()).toHaveLength(1);
  });

  it("exposes only record and no update or delete", () => {
    expect(Object.keys(audit)).toEqual(["record"]);
    expect(Object.keys(auditModule).filter((name) => /update|delete|remove/i.test(name))).toEqual(
      [],
    );
  });
});

describe("auditRecordInputSchema", () => {
  it("accepts each Core action", () => {
    for (const action of auditActions) {
      expect(auditRecordInputSchema.safeParse({ action, actorUserId: actor }).success).toBe(true);
    }
    expect(auditActions).toHaveLength(27);
    expect(
      auditRecordInputSchema.safeParse({ action: "override", actorUserId: actor }).success,
    ).toBe(false);
  });

  it("rejects an unknown action", () => {
    expect(auditRecordInputSchema.safeParse({ action: "hack", actorUserId: actor }).success).toBe(
      false,
    );
  });

  it("rejects an approver id", () => {
    expect(
      auditRecordInputSchema.safeParse({
        action: "login",
        actorUserId: actor,
        approverUserId: actor,
      }).success,
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
