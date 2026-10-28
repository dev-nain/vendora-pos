import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoLockInputSchema, autoLockSettingSchema } from "../../shared/settings";
import { ForbiddenError, SessionLockedError, UnauthenticatedError } from "../auth/errors";
import { createSessionStore, type SessionStore } from "../auth/session";
import { openDatabase, type VendoraDatabase } from "../db/client";
import { runMigrations } from "../db/migrate";
import { auditLog, stores, users, type UserRole } from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { getAutoLockMinutes } from "../settings/store-settings";
import { createAuditService } from "./audit";
import { createSettingsService } from "./settings";

describe("auto-lock schemas", () => {
  it.each([null, 1, 5, 60])("accepts %s", (minutes) => {
    expect(autoLockInputSchema.safeParse({ minutes }).success).toBe(true);
    expect(autoLockSettingSchema.safeParse({ minutes }).success).toBe(true);
  });

  it.each([0, 61, 1.5, "5", undefined, -1])("rejects %s", (minutes) => {
    expect(autoLockInputSchema.safeParse({ minutes }).success).toBe(false);
  });

  it("rejects missing input and extra keys", () => {
    expect(autoLockInputSchema.safeParse({}).success).toBe(false);
    expect(autoLockInputSchema.safeParse({ minutes: 5, extra: 1 }).success).toBe(false);
    expect(autoLockInputSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("createSettingsService", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let onAutoLockChanged: ReturnType<typeof vi.fn<() => void>>;
  let service: ReturnType<typeof createSettingsService>;

  const storeId = () => database.db.select().from(stores).get()!.id;
  const auditRows = () => database.db.select().from(auditLog).all();

  const signIn = (role: UserRole) => {
    const user = database.db
      .insert(users)
      .values({
        username: role,
        displayName: role,
        role,
        passwordHash: "p",
        pinHash: "q",
      })
      .returning()
      .get();
    sessions.start({ userId: user.id, role, storeId: storeId(), loggedInAt: new Date(0) });
    return user;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-settings-service-"));
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, {
      migrationsFolder: join(process.cwd(), "drizzle"),
      backupDir: join(dir, "backups"),
    });
    seedStoreAndTerminal(database);
    sessions = createSessionStore();
    onAutoLockChanged = vi.fn<() => void>();
    service = createSettingsService({
      database,
      audit: createAuditService(database),
      sessions,
      onAutoLockChanged,
    });
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lets the owner read the setting", () => {
    signIn("owner");

    expect(service.getAutoLock()).toEqual({ minutes: 5 });
  });

  it("writes the column and one settings_change row for the owner", () => {
    const owner = signIn("owner");

    expect(service.setAutoLock({ minutes: 1 })).toEqual({ minutes: 1 });
    expect(service.setAutoLock({ minutes: null })).toEqual({ minutes: null });

    expect(getAutoLockMinutes(database, storeId())).toBeNull();
    const rows = auditRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      action: "settings_change",
      actorUserId: owner.id,
      entityType: "store",
      entityId: storeId(),
    });
    expect(JSON.parse(rows[0]!.details!)).toEqual({ setting: "autoLockMinutes", from: 5, to: 1 });
    expect(JSON.parse(rows[1]!.details!)).toEqual({
      setting: "autoLockMinutes",
      from: 1,
      to: null,
    });
    expect(onAutoLockChanged).toHaveBeenCalledTimes(2);
  });

  it("writes nothing and does not call back when the value is unchanged", () => {
    signIn("owner");

    expect(service.setAutoLock({ minutes: 5 })).toEqual({ minutes: 5 });

    expect(auditRows()).toHaveLength(0);
    expect(onAutoLockChanged).not.toHaveBeenCalled();
  });

  it.each(["manager", "cashier"] as const)("refuses a %s on get and set", (role) => {
    signIn(role);

    expect(() => service.getAutoLock()).toThrow(ForbiddenError);
    expect(() => service.setAutoLock({ minutes: 10 })).toThrow(ForbiddenError);
    expect(getAutoLockMinutes(database, storeId())).toBe(5);
    expect(auditRows()).toHaveLength(0);
    expect(onAutoLockChanged).not.toHaveBeenCalled();
  });

  it("refuses with no session", () => {
    expect(() => service.getAutoLock()).toThrow(UnauthenticatedError);
    expect(() => service.setAutoLock({ minutes: 10 })).toThrow(UnauthenticatedError);
  });

  it("refuses while locked", () => {
    signIn("owner");
    sessions.lock();

    expect(() => service.getAutoLock()).toThrow(SessionLockedError);
    expect(() => service.setAutoLock({ minutes: 10 })).toThrow(SessionLockedError);
    expect(getAutoLockMinutes(database, storeId())).toBe(5);
  });
});
