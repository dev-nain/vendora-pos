import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  authResultSchema,
  loginUserSchema,
  safeUserSchema,
  type AuthResult,
} from "../../shared/auth";
import { hashCredential } from "../auth/credentials";
import { UnauthenticatedError } from "../auth/errors";
import { createSessionStore, type SessionStore } from "../auth/session";
import { openDatabase, type VendoraDatabase } from "../db/client";
import { runMigrations } from "../db/migrate";
import { auditLog, terminals, users } from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { createAuditService } from "./audit";
import { createAuthService } from "./auth";

const PASSWORD = "secret-pass";
const PIN = "4821";

let passwordHash: string;
let pinHash: string;

beforeAll(async () => {
  passwordHash = await hashCredential(PASSWORD);
  pinHash = await hashCredential(PIN);
});

describe("createAuthService", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let clock: Date;
  let service: ReturnType<typeof createAuthService>;

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

  const auditRows = () => database.db.select().from(auditLog).all();
  const userRow = (id: string) =>
    database.db
      .select()
      .from(users)
      .all()
      .find((row) => row.id === id)!;

  const asUser = async (username: string) => {
    const result = await service.login({ username, password: PASSWORD });
    expect(result.ok).toBe(true);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-auth-"));
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, {
      migrationsFolder: join(process.cwd(), "drizzle"),
      backupDir: join(dir, "backups"),
    });
    seedStoreAndTerminal(database);
    sessions = createSessionStore();
    clock = t0;
    service = createAuthService({
      database,
      audit: createAuditService(database),
      sessions,
      now: () => clock,
    });
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("login", () => {
    it("starts a session and writes one audit row", async () => {
      const owner = addUser("owner", "Owner", "owner");

      const result = await service.login({ username: "owner", password: PASSWORD });

      expect(result).toEqual({
        ok: true,
        user: { id: owner.id, username: "owner", displayName: "Owner", role: "owner" },
      });
      const terminal = database.db.select().from(terminals).get()!;
      expect(sessions.current()).toEqual({
        userId: owner.id,
        role: "owner",
        storeId: terminal.storeId,
        loggedInAt: t0,
      });
      const rows = auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "login", actorUserId: owner.id });
      expect(JSON.parse(rows[0]!.details!)).toEqual({ method: "password" });
    });

    it("matches the username case-insensitively", async () => {
      addUser("Owner", "Owner", "owner");

      const result = await service.login({ username: "OWNER", password: PASSWORD });

      expect(result.ok).toBe(true);
    });

    it("gives the same refusal for wrong, unknown, inactive and deleted users", async () => {
      addUser("wrong", "Wrong", "cashier");
      addUser("inactive", "Inactive", "cashier", { isActive: false });
      addUser("deleted", "Deleted", "cashier", { deletedAt: t0 });

      const results = [
        await service.login({ username: "wrong", password: "nope" }),
        await service.login({ username: "nobody", password: PASSWORD }),
        await service.login({ username: "inactive", password: PASSWORD }),
        await service.login({ username: "deleted", password: PASSWORD }),
      ];

      for (const result of results) expect(result).toEqual(results[0]);
      expect(results[0]).toEqual({
        ok: false,
        reason: "invalid-credentials",
        message: "Username or password is incorrect",
      });
      expect(sessions.current()).toBeNull();
      expect(auditRows()).toHaveLength(0);
    });

    it("replaces an existing session with one login row", async () => {
      addUser("owner", "Owner", "owner");
      const cashier = addUser("cashier", "Cashier", "cashier");
      await asUser("owner");

      await asUser("cashier");

      expect(sessions.current()?.userId).toBe(cashier.id);
      expect(auditRows()).toHaveLength(2);
    });
  });

  describe("switchByPin", () => {
    it("moves the session and writes a pin login row", async () => {
      const owner = addUser("owner", "Owner", "owner");
      const cashier = addUser("cashier", "Cashier", "cashier", { failedPinAttempts: 2 });
      await asUser("owner");

      const result = await service.switchByPin({ userId: cashier.id, pin: PIN });

      expect(result.ok).toBe(true);
      expect(sessions.current()).toMatchObject({ userId: cashier.id, role: "cashier" });
      expect(userRow(cashier.id).failedPinAttempts).toBe(0);
      const row = auditRows().find((r) => r.actorUserId === cashier.id)!;
      expect(row.action).toBe("login");
      expect(JSON.parse(row.details!)).toEqual({ method: "pin", previousUserId: owner.id });
    });

    it("refuses a wrong PIN and counts the attempt", async () => {
      const owner = addUser("owner", "Owner", "owner");
      const cashier = addUser("cashier", "Cashier", "cashier");
      await asUser("owner");

      const result = await service.switchByPin({ userId: cashier.id, pin: "0000" });

      expect(result).toEqual({ ok: false, reason: "invalid-pin", message: "PIN is incorrect" });
      expect(sessions.current()?.userId).toBe(owner.id);
      expect(userRow(cashier.id).failedPinAttempts).toBe(1);
      expect(auditRows()).toHaveLength(1);
    });

    it("locks after five wrong PINs until the cooldown passes", async () => {
      addUser("owner", "Owner", "owner");
      const cashier = addUser("cashier", "Cashier", "cashier");
      await asUser("owner");

      for (let i = 0; i < 5; i += 1) {
        const result = await service.switchByPin({ userId: cashier.id, pin: "0000" });
        expect(result).toMatchObject({ reason: "invalid-pin" });
      }

      clock = new Date(t0.getTime() + 10_000);
      const locked = await service.switchByPin({ userId: cashier.id, pin: PIN });
      expect(locked).toEqual({
        ok: false,
        reason: "pin-locked",
        message: "PIN is incorrect",
        retryAfterMs: 20_000,
      });
      expect(sessions.current()?.role).toBe("owner");

      clock = new Date(t0.getTime() + 30_000);
      const result = await service.switchByPin({ userId: cashier.id, pin: PIN });
      expect(result.ok).toBe(true);
      expect(userRow(cashier.id)).toMatchObject({ failedPinAttempts: 0, pinRetryAfter: null });
    });

    it("keeps the cooldown across a new service instance", async () => {
      addUser("owner", "Owner", "owner");
      const cashier = addUser("cashier", "Cashier", "cashier");
      await asUser("owner");
      for (let i = 0; i < 5; i += 1) {
        await service.switchByPin({ userId: cashier.id, pin: "0000" });
      }

      const restarted = createAuthService({
        database,
        audit: createAuditService(database),
        sessions,
        now: () => clock,
      });

      expect(await restarted.switchByPin({ userId: cashier.id, pin: PIN })).toMatchObject({
        reason: "pin-locked",
      });
    });

    it("refuses inactive and soft-deleted users", async () => {
      addUser("owner", "Owner", "owner");
      const inactive = addUser("inactive", "Inactive", "cashier", { isActive: false });
      const deleted = addUser("deleted", "Deleted", "cashier", { deletedAt: t0 });
      await asUser("owner");

      for (const target of [inactive, deleted]) {
        expect(await service.switchByPin({ userId: target.id, pin: PIN })).toMatchObject({
          reason: "invalid-pin",
        });
      }
      expect(sessions.current()?.role).toBe("owner");
    });

    it("throws with no session", async () => {
      const cashier = addUser("cashier", "Cashier", "cashier");

      await expect(service.switchByPin({ userId: cashier.id, pin: PIN })).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
    });
  });

  describe("logout", () => {
    it("clears the session and audits once", async () => {
      const owner = addUser("owner", "Owner", "owner");
      await asUser("owner");

      service.logout();
      service.logout();

      expect(sessions.current()).toBeNull();
      const logouts = auditRows().filter((row) => row.action === "logout");
      expect(logouts).toHaveLength(1);
      expect(logouts[0]!.actorUserId).toBe(owner.id);
    });
  });

  describe("current and listLoginUsers", () => {
    it("current is null with no session", () => {
      expect(service.current()).toBeNull();
    });

    it("current clears the session once the user is deactivated", async () => {
      const owner = addUser("owner", "Owner", "owner");
      await asUser("owner");
      expect(service.current()?.id).toBe(owner.id);

      database.sqlite.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(owner.id);

      expect(service.current()).toBeNull();
      expect(sessions.current()).toBeNull();
    });

    it("current clears the session once the user is soft-deleted", async () => {
      const owner = addUser("owner", "Owner", "owner");
      await asUser("owner");

      database.sqlite.prepare("UPDATE users SET deleted_at = 1 WHERE id = ?").run(owner.id);

      expect(service.current()).toBeNull();
    });

    it("lists only active users ordered by display name", () => {
      addUser("b", "Bilal", "cashier");
      addUser("a", "Asad", "owner");
      addUser("c", "Chand", "cashier", { isActive: false });
      addUser("d", "Danish", "cashier", { deletedAt: t0 });

      const list = service.listLoginUsers();

      expect(list.map((u) => u.displayName)).toEqual(["Asad", "Bilal"]);
      expect(Object.keys(list[0]!).toSorted()).toEqual(["displayName", "id", "role"]);
    });
  });

  describe("no secrets in returned values", () => {
    it("never returns passwords, PINs or hashes", async () => {
      addUser("owner", "Owner", "owner");
      const cashier = addUser("cashier", "Cashier", "cashier");
      const returned: unknown[] = [];

      returned.push(await service.login({ username: "owner", password: "bad" }));
      returned.push(await service.login({ username: "owner", password: PASSWORD }));
      returned.push(service.current());
      returned.push(service.listLoginUsers());
      returned.push(await service.switchByPin({ userId: cashier.id, pin: "0000" }));
      for (let i = 0; i < 4; i += 1) {
        returned.push(await service.switchByPin({ userId: cashier.id, pin: "0000" }));
      }
      returned.push(await service.switchByPin({ userId: cashier.id, pin: PIN }));
      clock = new Date(t0.getTime() + 60_000);
      returned.push(await service.switchByPin({ userId: cashier.id, pin: PIN }));
      returned.push(service.current());
      returned.push(service.logout());

      const text = JSON.stringify(returned);
      for (const secret of [PASSWORD, PIN, passwordHash, pinHash]) {
        expect(text).not.toContain(secret);
      }
      for (const key of ["password", "pin", "passwordHash", "pinHash"]) {
        expect(text).not.toContain(`"${key}"`);
      }

      for (const value of returned) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const item of value) expect(loginUserSchema.safeParse(item).success).toBe(true);
        } else if ("ok" in (value as object)) {
          expect(authResultSchema.safeParse(value as AuthResult).success).toBe(true);
        } else {
          expect(safeUserSchema.safeParse(value).success).toBe(true);
        }
      }
    });
  });
});
