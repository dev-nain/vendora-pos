import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  miscItemInputSchema,
  miscItemSettingSchema,
  scalePrefixesInputSchema,
  scalePrefixesSettingSchema,
  shiftVarianceInputSchema,
} from "../../shared/settings";
import { UnauthenticatedError } from "../auth/errors";
import { createSessionStore, type SessionStore } from "../auth/session";
import { openDatabase, type VendoraDatabase } from "../db/client";
import { runMigrations } from "../db/migrate";
import { auditLog, stores, users } from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import {
  getMiscItemEnabled,
  getScalePrefixes,
  getShiftVarianceWarnPaisa,
} from "../settings/store-settings";
import { createAuditService } from "./audit";
import { createSettingsService } from "./settings";

describe("misc item schemas", () => {
  it.each([true, false])("accepts %s", (enabled) => {
    expect(miscItemInputSchema.safeParse({ enabled }).success).toBe(true);
    expect(miscItemSettingSchema.safeParse({ enabled }).success).toBe(true);
  });

  it.each(["yes", 1, null, undefined])("rejects %s", (enabled) => {
    expect(miscItemInputSchema.safeParse({ enabled }).success).toBe(false);
  });

  it("rejects missing input and extra keys", () => {
    expect(miscItemInputSchema.safeParse({}).success).toBe(false);
    expect(miscItemInputSchema.safeParse({ enabled: true, extra: 1 }).success).toBe(false);
    expect(miscItemInputSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("scale prefix schemas", () => {
  it.each([
    { weightPrefix: "21", pricePrefix: "22" },
    { weightPrefix: "02", pricePrefix: "29" },
  ])("accepts %j", (value) => {
    expect(scalePrefixesInputSchema.safeParse(value).success).toBe(true);
    expect(scalePrefixesSettingSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    { weightPrefix: "21", pricePrefix: "21" },
    { weightPrefix: "2", pricePrefix: "22" },
    { weightPrefix: "21", pricePrefix: "222" },
    { weightPrefix: 21, pricePrefix: "22" },
    { weightPrefix: "2a", pricePrefix: "22" },
    { weightPrefix: "21" },
    { pricePrefix: "22" },
    { weightPrefix: "21", pricePrefix: "22", extra: 1 },
  ])("rejects %j", (value) => {
    expect(scalePrefixesInputSchema.safeParse(value).success).toBe(false);
  });
});

describe("shift variance schema", () => {
  it.each([0, 15000, 100_000_000])("accepts %s", (warnPaisa) => {
    expect(shiftVarianceInputSchema.safeParse({ warnPaisa }).success).toBe(true);
  });

  it.each([-1, 1.5, 100_000_001, "5", null])("rejects %s", (warnPaisa) => {
    expect(shiftVarianceInputSchema.safeParse({ warnPaisa }).success).toBe(false);
  });

  it("rejects extra keys", () => {
    expect(shiftVarianceInputSchema.safeParse({ warnPaisa: 0, extra: 1 }).success).toBe(false);
  });
});

describe("createSettingsService", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let service: ReturnType<typeof createSettingsService>;

  const storeId = () => database.db.select().from(stores).get()!.id;
  const auditRows = () => database.db.select().from(auditLog).all();

  const signIn = (name: string) => {
    const user = database.db
      .insert(users)
      .values({
        username: name,
        displayName: name,
        passwordHash: "p",
        pinHash: "q",
      })
      .returning()
      .get();
    sessions.start({ userId: user.id, storeId: storeId(), loggedInAt: new Date(0) });
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
    service = createSettingsService({ database, audit: createAuditService(database), sessions });
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("misc item", () => {
    it("lets the owner read and set it, writing one settings_change row", () => {
      const owner = signIn("owner");

      expect(service.getMiscItemEnabled()).toEqual({ enabled: false });
      expect(service.setMiscItemEnabled({ enabled: true })).toEqual({ enabled: true });

      expect(getMiscItemEnabled(database, storeId())).toBe(true);
      const rows = auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: "settings_change",
        actorUserId: owner.id,
        entityType: "store",
        entityId: storeId(),
      });
      expect(JSON.parse(rows[0]!.details!)).toEqual({
        setting: "miscItemEnabled",
        from: false,
        to: true,
      });
    });

    it("writes nothing when the value is unchanged", () => {
      signIn("owner");

      expect(service.setMiscItemEnabled({ enabled: false })).toEqual({ enabled: false });

      expect(auditRows()).toHaveLength(0);
    });

    it.each(["manager", "cashier"] as const)("lets a %s get and set", (name) => {
      signIn(name);

      expect(service.getMiscItemEnabled()).toEqual({ enabled: false });
      expect(service.setMiscItemEnabled({ enabled: true })).toEqual({ enabled: true });
      expect(getMiscItemEnabled(database, storeId())).toBe(true);
      expect(auditRows()).toHaveLength(1);
    });

    it("refuses with no session", () => {
      expect(() => service.getMiscItemEnabled()).toThrow(UnauthenticatedError);
      expect(() => service.setMiscItemEnabled({ enabled: true })).toThrow(UnauthenticatedError);
      expect(getMiscItemEnabled(database, storeId())).toBe(false);
      expect(auditRows()).toHaveLength(0);
    });
  });

  describe("shift variance warning", () => {
    it("reads 0 by default", () => {
      signIn("cashier");

      expect(service.getShiftVarianceWarn()).toEqual({ warnPaisa: 0 });
    });

    it("sets it and writes one settings_change row with from and to", () => {
      const user = signIn("cashier");

      expect(service.setShiftVarianceWarn({ warnPaisa: 15000 })).toEqual({ warnPaisa: 15000 });

      expect(getShiftVarianceWarnPaisa(database, storeId())).toBe(15000);
      const rows = auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: "settings_change",
        actorUserId: user.id,
        entityType: "store",
        entityId: storeId(),
      });
      expect(JSON.parse(rows[0]!.details!)).toEqual({
        setting: "shiftVarianceWarnPaisa",
        from: 0,
        to: 15000,
      });
    });

    it("writes nothing when unchanged", () => {
      signIn("cashier");

      service.setShiftVarianceWarn({ warnPaisa: 0 });

      expect(auditRows()).toHaveLength(0);
    });

    it("refuses with no session", () => {
      expect(() => service.getShiftVarianceWarn()).toThrow(UnauthenticatedError);
      expect(() => service.setShiftVarianceWarn({ warnPaisa: 5 })).toThrow(UnauthenticatedError);
      expect(getShiftVarianceWarnPaisa(database, storeId())).toBe(0);
    });
  });

  describe("setScalePrefixes", () => {
    const input = { weightPrefix: "02", pricePrefix: "29" };

    it("saves for the owner with one settings_change row", () => {
      const owner = signIn("owner");

      expect(service.setScalePrefixes(input)).toEqual(input);

      expect(getScalePrefixes(database, storeId())).toEqual(input);
      const rows = auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: "settings_change",
        actorUserId: owner.id,
        entityType: "store",
        entityId: storeId(),
      });
      expect(JSON.parse(rows[0]!.details!)).toEqual({
        setting: "scalePrefixes",
        from: { weightPrefix: "21", pricePrefix: "22" },
        to: input,
      });
    });

    it("writes nothing when unchanged", () => {
      signIn("owner");

      expect(service.setScalePrefixes({ weightPrefix: "21", pricePrefix: "22" })).toEqual({
        weightPrefix: "21",
        pricePrefix: "22",
      });
      expect(auditRows()).toHaveLength(0);
    });

    it.each(["manager", "cashier"] as const)("lets a %s save", (name) => {
      signIn(name);

      expect(service.setScalePrefixes(input)).toEqual(input);
      expect(getScalePrefixes(database, storeId())).toEqual(input);
      expect(auditRows()).toHaveLength(1);
    });

    it("refuses with no session", () => {
      expect(() => service.setScalePrefixes(input)).toThrow(UnauthenticatedError);
      expect(auditRows()).toHaveLength(0);
    });
  });
});
