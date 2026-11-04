import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authMessages } from "../../shared/auth";
import { userMessages } from "../../shared/users";
import { hashCredential, verifyCredential } from "../auth/credentials";
import { UnauthenticatedError } from "../auth/errors";
import { createSessionStore, type SessionStore } from "../auth/session";
import { openDatabase, type VendoraDatabase } from "../db/client";
import { runMigrations } from "../db/migrate";
import { auditLog, terminals, users } from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { createAuditService } from "./audit";
import { createAuthService } from "./auth";
import { createUsersService } from "./users";

const PASSWORD = "secret-pass";
const PIN = "4821";

let passwordHash: string;
let pinHash: string;

beforeAll(async () => {
  passwordHash = await hashCredential(PASSWORD);
  pinHash = await hashCredential(PIN);
});

describe("createUsersService", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let clock: Date;
  let auth: ReturnType<typeof createAuthService>;
  let service: ReturnType<typeof createUsersService>;

  const t0 = new Date("2026-01-01T10:00:00.000Z");

  const addUser = (
    username: string,
    displayName: string,
    role: "owner" | "manager" | "cashier",
    extra: Partial<typeof users.$inferInsert> = {},
  ) =>
    database.db
      .insert(users)
      .values({ username, displayName, role, passwordHash, pinHash, ...extra })
      .returning()
      .get();

  const userRow = (id: string) =>
    database.db
      .select()
      .from(users)
      .all()
      .find((row) => row.id === id)!;
  const auditRows = () => database.db.select().from(auditLog).all();

  const signInAs = (user: { id: string; role: "owner" | "manager" | "cashier" }) => {
    const terminal = database.db.select().from(terminals).get()!;
    sessions.start({
      userId: user.id,
      role: user.role,
      storeId: terminal.storeId,
      loggedInAt: t0,
    });
  };

  const newUser = {
    username: "sara",
    displayName: "Sara Khan",
    role: "manager" as const,
    password: "ab123",
    pin: "5555",
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-users-"));
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, {
      migrationsFolder: join(process.cwd(), "drizzle"),
      backupDir: join(dir, "backups"),
    });
    seedStoreAndTerminal(database);
    sessions = createSessionStore();
    clock = t0;
    const audit = createAuditService(database);
    auth = createAuthService({ database, audit, sessions, now: () => clock });
    service = createUsersService({ database, audit, sessions, now: () => clock });
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const calls = (id: string): (() => unknown)[] => [
    () => service.list(),
    () => service.create(newUser),
    () => service.update({ id, displayName: "X", role: "cashier" }),
    () => service.resetPassword({ id, password: "abcd" }),
    () => service.resetPin({ id, pin: "1234" }),
    () => service.deactivate({ id }),
    () => service.reactivate({ id }),
  ];

  describe("session", () => {
    it("refuses a signed-out call", async () => {
      const target = addUser("target", "Target", "cashier");

      for (const call of calls(target.id)) {
        await expect(Promise.resolve().then(call)).rejects.toBeInstanceOf(UnauthenticatedError);
      }

      expect(auditRows()).toHaveLength(0);
    });
  });

  describe("create", () => {
    it("stores verifiable hashes and audits user_create without secrets", async () => {
      const owner = addUser("owner", "Owner", "owner");
      signInAs(owner);

      const result = await service.create(newUser);

      expect(result.ok).toBe(true);
      const row = database.db
        .select()
        .from(users)
        .all()
        .find((u) => u.username === "sara")!;
      expect(await verifyCredential(row.passwordHash, "ab123")).toBe(true);
      expect(await verifyCredential(row.pinHash, "5555")).toBe(true);
      expect(result).toEqual({
        ok: true,
        user: {
          id: row.id,
          username: "sara",
          displayName: "Sara Khan",
          role: "manager",
          isActive: true,
          pinLocked: false,
        },
      });
      const rows = auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: "user_create",
        actorUserId: owner.id,
        entityType: "user",
        entityId: row.id,
      });
      expect(JSON.parse(rows[0]!.details!)).toEqual({ username: "sara", role: "manager" });
    });

    it("returns username-taken ignoring case, including for inactive users", async () => {
      const owner = addUser("owner", "Owner", "owner");
      addUser("gone", "Gone", "cashier", { isActive: false });
      signInAs(owner);

      const taken = await service.create({ ...newUser, username: "Owner" });
      const inactive = await service.create({ ...newUser, username: "GONE" });

      expect(taken).toEqual({
        ok: false,
        reason: "username-taken",
        message: userMessages.usernameTaken,
      });
      expect(inactive).toMatchObject({ ok: false, reason: "username-taken" });
      expect(database.db.select().from(users).all()).toHaveLength(2);
      expect(auditRows()).toHaveLength(0);
    });

    it("lets the created user log in and switch by PIN", async () => {
      const owner = addUser("owner", "Owner", "owner");
      signInAs(owner);
      const created = await service.create({ ...newUser, role: "cashier" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const login = await auth.login({ username: "sara", password: "ab123" });
      expect(login).toMatchObject({ ok: true, user: { role: "cashier" } });

      signInAs(owner);
      const switched = await auth.switchByPin({ userId: created.user.id, pin: "5555" });
      expect(switched).toMatchObject({ ok: true });
    });
  });

  describe("list", () => {
    it("returns no hash keys, inactive users, and sorts active first by name", () => {
      const owner = addUser("owner", "Zed", "owner");
      addUser("a", "adam", "cashier", { isActive: false });
      addUser("b", "Bilal", "cashier");
      signInAs(owner);

      const list = service.list();

      expect(list.map((u) => u.displayName)).toEqual(["Bilal", "Zed", "adam"]);
      for (const user of list) {
        expect(Object.keys(user).toSorted()).toEqual([
          "displayName",
          "id",
          "isActive",
          "pinLocked",
          "role",
          "username",
        ]);
      }
    });

    it("flags pinLocked only while the cooldown is in the future", () => {
      const owner = addUser("owner", "Owner", "owner");
      addUser("locked", "Locked", "cashier", {
        failedPinAttempts: 5,
        pinRetryAfter: new Date(t0.getTime() + 30_000),
      });
      addUser("past", "Past", "cashier", {
        failedPinAttempts: 5,
        pinRetryAfter: new Date(t0.getTime() - 1000),
      });
      signInAs(owner);

      const byName = Object.fromEntries(service.list().map((u) => [u.username, u.pinLocked]));

      expect(byName).toMatchObject({ locked: true, past: false, owner: false });
    });
  });

  describe("update", () => {
    it("changes display name and role and audits only changed fields", () => {
      const owner = addUser("owner", "Owner", "owner");
      const target = addUser("t", "Old Name", "cashier");
      signInAs(owner);

      const renamed = service.update({ id: target.id, displayName: "New Name", role: "cashier" });
      const promoted = service.update({ id: target.id, displayName: "New Name", role: "manager" });

      expect(renamed).toEqual({ ok: true, sessionEnded: false });
      expect(promoted).toEqual({ ok: true, sessionEnded: false });
      expect(userRow(target.id)).toMatchObject({ displayName: "New Name", role: "manager" });
      const rows = auditRows();
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.action)).toEqual(["user_update", "user_update"]);
      expect(rows.map((r) => JSON.parse(r.details!))).toEqual([
        { changes: { displayName: { from: "Old Name", to: "New Name" } } },
        { changes: { role: { from: "cashier", to: "manager" } } },
      ]);
      expect(rows[0]!.actorUserId).toBe(owner.id);
    });

    it("writes no row when nothing changed", () => {
      const owner = addUser("owner", "Owner", "owner");
      const target = addUser("t", "Name", "cashier");
      signInAs(owner);

      const result = service.update({ id: target.id, displayName: "Name", role: "cashier" });

      expect(result).toEqual({ ok: true, sessionEnded: false });
      expect(auditRows()).toHaveLength(0);
    });

    it("returns not-found for an unknown id", () => {
      signInAs(addUser("owner", "Owner", "owner"));

      const result = service.update({
        id: "0190a3b4-7c5d-7e8f-9a0b-1c2d3e4f5a6b",
        displayName: "X",
        role: "cashier",
      });

      expect(result).toMatchObject({ ok: false, reason: "not-found" });
    });
  });

  describe("last-Owner guard", () => {
    it("refuses to deactivate the only active Owner", () => {
      const owner = addUser("owner", "Owner", "owner");
      signInAs(owner);

      const result = service.deactivate({ id: owner.id });

      expect(result).toEqual({
        ok: false,
        reason: "last-owner",
        message: userMessages.lastOwner,
      });
      expect(userRow(owner.id).isActive).toBe(true);
      expect(auditRows()).toHaveLength(0);
      expect(sessions.current()).not.toBeNull();
    });

    it("refuses to move the only active Owner to another role", () => {
      const owner = addUser("owner", "Owner", "owner");
      signInAs(owner);

      const result = service.update({ id: owner.id, displayName: "Owner", role: "manager" });

      expect(result).toMatchObject({ ok: false, reason: "last-owner" });
      expect(userRow(owner.id).role).toBe("owner");
      expect(auditRows()).toHaveLength(0);
    });

    it("allows both with a second active Owner", () => {
      const owner = addUser("owner", "Owner", "owner");
      const other = addUser("other", "Other", "owner");
      signInAs(owner);

      expect(service.update({ id: other.id, displayName: "Other", role: "cashier" }).ok).toBe(true);
      expect(userRow(other.id).role).toBe("cashier");
      const third = addUser("third", "Third", "owner");
      expect(service.deactivate({ id: third.id }).ok).toBe(true);
      expect(userRow(third.id).isActive).toBe(false);
    });

    it("does not count an inactive second Owner", () => {
      const owner = addUser("owner", "Owner", "owner");
      addUser("other", "Other", "owner", { isActive: false });
      signInAs(owner);

      expect(service.deactivate({ id: owner.id })).toMatchObject({
        ok: false,
        reason: "last-owner",
      });
    });
  });

  describe("deactivate and reactivate", () => {
    it("flips isActive, keeps deletedAt null, and audits each change once", async () => {
      const owner = addUser("owner", "Owner", "owner");
      const target = addUser("t", "Target", "cashier");
      signInAs(owner);

      expect(service.deactivate({ id: target.id })).toEqual({ ok: true, sessionEnded: false });
      expect(service.deactivate({ id: target.id })).toEqual({ ok: true, sessionEnded: false });
      expect(userRow(target.id)).toMatchObject({ isActive: false, deletedAt: null });

      expect(await auth.login({ username: "t", password: PASSWORD })).toMatchObject({
        ok: false,
        reason: "invalid-credentials",
        message: authMessages.invalidCredentials,
      });
      signInAs(owner);
      expect(await auth.switchByPin({ userId: target.id, pin: PIN })).toMatchObject({
        ok: false,
        reason: "invalid-pin",
      });
      signInAs(owner);

      expect(service.reactivate({ id: target.id })).toEqual({ ok: true });
      expect(service.reactivate({ id: target.id })).toEqual({ ok: true });
      expect(userRow(target.id)).toMatchObject({ isActive: true, deletedAt: null });
      expect(await auth.login({ username: "t", password: PASSWORD })).toMatchObject({ ok: true });

      const rows = auditRows().filter((r) => r.action.startsWith("user_"));
      expect(rows.map((r) => r.action)).toEqual(["user_deactivate", "user_reactivate"]);
      expect(rows.map((r) => JSON.parse(r.details!))).toEqual([
        { username: "t" },
        { username: "t" },
      ]);
      expect(rows.every((r) => r.actorUserId === owner.id && r.entityId === target.id)).toBe(true);
    });

    it("returns not-found for unknown ids", () => {
      signInAs(addUser("owner", "Owner", "owner"));
      const id = "0190a3b4-7c5d-7e8f-9a0b-1c2d3e4f5a6b";

      expect(service.deactivate({ id })).toMatchObject({ ok: false, reason: "not-found" });
      expect(service.reactivate({ id })).toMatchObject({ ok: false, reason: "not-found" });
    });
  });

  describe("resets", () => {
    it("resetPassword replaces the password and audits the reset", async () => {
      const owner = addUser("owner", "Owner", "owner");
      const target = addUser("t", "Target", "cashier");
      signInAs(owner);

      expect(await service.resetPassword({ id: target.id, password: "zz999" })).toEqual({
        ok: true,
      });

      expect(await auth.login({ username: "t", password: PASSWORD })).toMatchObject({ ok: false });
      expect(await auth.login({ username: "t", password: "zz999" })).toMatchObject({ ok: true });
      const rows = auditRows().filter((r) => r.action === "user_update");
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0]!.details!)).toEqual({ reset: "password" });
      expect(rows[0]!.actorUserId).toBe(owner.id);
    });

    it("resetPin clears the lockout so the new PIN works at once", async () => {
      const owner = addUser("owner", "Owner", "owner");
      const target = addUser("t", "Target", "cashier", {
        failedPinAttempts: 5,
        pinRetryAfter: new Date(t0.getTime() + 60_000),
      });
      signInAs(owner);

      expect(await service.resetPin({ id: target.id, pin: "7777" })).toEqual({ ok: true });

      expect(userRow(target.id)).toMatchObject({ failedPinAttempts: 0, pinRetryAfter: null });
      expect(await auth.switchByPin({ userId: target.id, pin: "7777" })).toMatchObject({
        ok: true,
      });
      const rows = auditRows().filter((r) => r.action === "user_update");
      expect(JSON.parse(rows[0]!.details!)).toEqual({ reset: "pin" });
    });

    it("returns not-found for unknown ids", async () => {
      signInAs(addUser("owner", "Owner", "owner"));
      const id = "0190a3b4-7c5d-7e8f-9a0b-1c2d3e4f5a6b";

      expect(await service.resetPassword({ id, password: "abcd" })).toMatchObject({
        reason: "not-found",
      });
      expect(await service.resetPin({ id, pin: "1234" })).toMatchObject({ reason: "not-found" });
    });
  });

  describe("session end", () => {
    it("ends the session when the Owner deactivates themselves", () => {
      const owner = addUser("owner", "Owner", "owner");
      addUser("other", "Other", "owner");
      signInAs(owner);

      const result = service.deactivate({ id: owner.id });

      expect(result).toEqual({ ok: true, sessionEnded: true });
      expect(sessions.current()).toBeNull();
    });

    it("ends the session when the Owner changes their own role", () => {
      const owner = addUser("owner", "Owner", "owner");
      addUser("other", "Other", "owner");
      signInAs(owner);

      const result = service.update({ id: owner.id, displayName: "Owner", role: "manager" });

      expect(result).toEqual({ ok: true, sessionEnded: true });
      expect(sessions.current()).toBeNull();
    });

    it("keeps the session when the Owner edits their own display name", () => {
      const owner = addUser("owner", "Owner", "owner");
      signInAs(owner);

      const result = service.update({ id: owner.id, displayName: "Boss", role: "owner" });

      expect(result).toEqual({ ok: true, sessionEnded: false });
      expect(sessions.current()).not.toBeNull();
    });

    it("keeps the session when the Owner deactivates someone else", () => {
      const owner = addUser("owner", "Owner", "owner");
      const target = addUser("t", "Target", "cashier");
      signInAs(owner);

      expect(service.deactivate({ id: target.id })).toEqual({ ok: true, sessionEnded: false });
      expect(sessions.current()).not.toBeNull();
    });
  });

  it("never stores a plain password or PIN in an audit row", async () => {
    const owner = addUser("owner", "Owner", "owner");
    signInAs(owner);
    const created = await service.create(newUser);
    if (!created.ok) throw new Error("create failed");
    await service.resetPassword({ id: created.user.id, password: "qw987" });
    await service.resetPin({ id: created.user.id, pin: "9182" });
    service.update({ id: created.user.id, displayName: "Sara K", role: "cashier" });
    service.deactivate({ id: created.user.id });
    service.reactivate({ id: created.user.id });

    const dump = JSON.stringify(auditRows());

    for (const secret of ["ab123", "5555", "qw987", "9182", "$argon2"]) {
      expect(dump).not.toContain(secret);
    }
    expect(auditRows()).toHaveLength(6);
  });
});
