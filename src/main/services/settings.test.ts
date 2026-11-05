import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  miscItemInputSchema,
  miscItemSettingSchema,
  printerSettingsSchema,
  receiptSettingsInputSchema,
  scalePrefixesInputSchema,
  scalePrefixesSettingSchema,
  shiftVarianceInputSchema,
} from "../../shared/settings";
import { UnauthenticatedError } from "../auth/errors";
import { createSessionStore, type SessionStore } from "../auth/session";
import { openDatabase, type VendoraDatabase } from "../db/client";
import { runMigrations } from "../db/migrate";
import { auditLog, stores, terminals, users } from "../db/schema";
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

const blankReceipt = {
  name: null,
  address: null,
  phone: null,
  ntn: null,
  strn: null,
  headerEn: null,
  headerUr: null,
  footerEn: null,
  footerUr: null,
};

const parseReceipt = (patch: Record<string, string | null>) =>
  receiptSettingsInputSchema.safeParse({ ...blankReceipt, ...patch });

describe("receipt settings schema", () => {
  it("turns empty and whitespace-only text into null and trims the rest", () => {
    const result = parseReceipt({ name: "  Al Noor  ", address: "   ", headerEn: "" });
    expect(result.success && result.data).toMatchObject({
      name: "Al Noor",
      address: null,
      headerEn: null,
    });
  });

  it("stores the NTN as 7 digits, a dash and 1 digit", () => {
    const result = parseReceipt({ ntn: "12345678" });
    expect(result.success && result.data.ntn).toBe("1234567-8");
    expect(parseReceipt({ ntn: "123456" }).success).toBe(false);
  });

  it("stores the STRN as 13 digits only", () => {
    const dashed = parseReceipt({ strn: "32-77-8761-234-19" });
    expect(dashed.success && dashed.data.strn).toBe("3277876123419");
    expect(parseReceipt({ strn: "3277876123419" }).success).toBe(true);
    expect(parseReceipt({ strn: "327787612341" }).success).toBe(false);
    expect(parseReceipt({ strn: "32778761234AB" }).success).toBe(false);
  });

  it("accepts phone digits, spaces, + and - up to 30 characters", () => {
    expect(parseReceipt({ phone: "+92 300 1234567" }).success).toBe(true);
    expect(parseReceipt({ phone: "0300-abc" }).success).toBe(false);
    expect(parseReceipt({ phone: "1".repeat(30) }).success).toBe(true);
    expect(parseReceipt({ phone: "1".repeat(31) }).success).toBe(false);
  });

  it("limits the address to 200 characters", () => {
    expect(parseReceipt({ address: "a".repeat(200) }).success).toBe(true);
    expect(parseReceipt({ address: "a".repeat(201) }).success).toBe(false);
  });

  it("limits a header to 300 characters and 4 lines", () => {
    expect(parseReceipt({ headerEn: "a".repeat(300) }).success).toBe(true);
    expect(parseReceipt({ headerEn: "a".repeat(301) }).success).toBe(false);
    expect(parseReceipt({ footerUr: "a\nb\nc\nd" }).success).toBe(true);
    expect(parseReceipt({ footerUr: "a\nb\nc\nd\ne" }).success).toBe(false);
  });

  it("rejects extra keys", () => {
    expect(receiptSettingsInputSchema.safeParse({ ...blankReceipt, extra: 1 }).success).toBe(false);
  });
});

describe("printer settings schema", () => {
  const base = { paperWidthMm: 80, printMode: "print" } as const;
  const parse = (connection: unknown, patch: Record<string, unknown> = {}) =>
    printerSettingsSchema.safeParse({ ...base, connection, ...patch });

  it("accepts each connection kind", () => {
    expect(parse({ kind: "none" }).success).toBe(true);
    expect(parse({ kind: "windows", name: "XP-80" }).success).toBe(true);
    expect(parse({ kind: "network", host: "192.168.1.50", port: 9100 }).success).toBe(true);
    expect(parse({ kind: "network", host: "receipt-printer.local", port: 1 }).success).toBe(true);
  });

  it("bounds the port and the host", () => {
    expect(parse({ kind: "network", host: "10.0.0.1", port: 0 }).success).toBe(false);
    expect(parse({ kind: "network", host: "10.0.0.1", port: 65536 }).success).toBe(false);
    expect(parse({ kind: "network", host: "10.0.0.1", port: 65535 }).success).toBe(true);
    expect(parse({ kind: "network", host: "10.0.0.1", port: 91.5 }).success).toBe(false);
    expect(parse({ kind: "network", host: "300.0.0.1", port: 9100 }).success).toBe(false);
    expect(parse({ kind: "network", host: "a b", port: 9100 }).success).toBe(false);
    expect(parse({ kind: "network", host: "", port: 9100 }).success).toBe(false);
    expect(parse({ kind: "network", host: "a".repeat(254), port: 9100 }).success).toBe(false);
  });

  it("needs a Windows printer name, only 58 or 80 mm and a known print mode", () => {
    expect(parse({ kind: "windows", name: "" }).success).toBe(false);
    expect(parse({ kind: "none" }, { paperWidthMm: 70 }).success).toBe(false);
    expect(parse({ kind: "none" }, { printMode: "never" }).success).toBe(false);
    expect(parse({ kind: "none" }, { paperWidthMm: 58, printMode: "ask" }).success).toBe(true);
  });
});

describe("createSettingsService", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let service: ReturnType<typeof createSettingsService>;

  const storeId = () => database.db.select().from(stores).get()!.id;
  const terminalId = () => database.db.select().from(terminals).get()!.id;
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
  describe("receipt settings", () => {
    const input = {
      ...blankReceipt,
      name: "Al Noor Store",
      ntn: "1234567-8",
      headerUr: "خوش آمدید",
    };

    it("reads blanks, saves, and writes one settings_change row with from and to", () => {
      const user = signIn("cashier");
      expect(service.getReceipt()).toEqual({ ...blankReceipt });

      expect(service.setReceipt(input)).toEqual(input);

      expect(service.getReceipt()).toEqual(input);
      const rows = auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: "settings_change",
        actorUserId: user.id,
        entityType: "store",
        entityId: storeId(),
      });
      expect(JSON.parse(rows[0]!.details!)).toEqual({
        setting: "receipt",
        from: blankReceipt,
        to: input,
      });
    });

    it("writes nothing when unchanged", () => {
      signIn("cashier");
      service.setReceipt(input);

      service.setReceipt(input);

      expect(auditRows()).toHaveLength(1);
    });

    it("refuses with no session", () => {
      expect(() => service.getReceipt()).toThrow(UnauthenticatedError);
      expect(() => service.setReceipt(input)).toThrow(UnauthenticatedError);
    });
  });

  describe("printer settings", () => {
    const network = {
      connection: { kind: "network", host: "192.168.1.50", port: 9100 },
      paperWidthMm: 58,
      printMode: "ask",
    } as const;

    it("defaults to none, 80 mm and print", () => {
      signIn("cashier");

      expect(service.getPrinter()).toEqual({
        connection: { kind: "none" },
        paperWidthMm: 80,
        printMode: "print",
      });
    });

    it("saves on the terminal row and audits one settings_change", () => {
      const user = signIn("cashier");

      expect(service.setPrinter(network)).toEqual(network);

      expect(service.getPrinter()).toEqual(network);
      const rows = auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: "settings_change",
        actorUserId: user.id,
        entityType: "terminal",
        entityId: terminalId(),
      });
      expect(JSON.parse(rows[0]!.details!)).toMatchObject({ setting: "printer", to: network });
    });

    it("clears the old connection fields when the kind changes", () => {
      signIn("cashier");
      service.setPrinter(network);

      service.setPrinter({ ...network, connection: { kind: "windows", name: "XP-80" } });

      const row = database.db.select().from(terminals).get()!;
      expect(row).toMatchObject({
        printerKind: "windows",
        printerName: "XP-80",
        printerHost: null,
        printerPort: null,
      });
    });

    it("writes nothing when unchanged", () => {
      signIn("cashier");
      service.setPrinter(network);

      service.setPrinter(network);

      expect(auditRows()).toHaveLength(1);
    });

    it("refuses with no session", () => {
      expect(() => service.getPrinter()).toThrow(UnauthenticatedError);
      expect(() => service.setPrinter(network)).toThrow(UnauthenticatedError);
    });

    it("lists no Windows printers off Windows and needs a session", async () => {
      await expect(service.listWindowsPrinters(async () => [])).rejects.toThrow(
        UnauthenticatedError,
      );
      signIn("cashier");
      const fetch = vi.fn(async () => [{ name: "a", displayName: "A", isDefault: false }]);

      const result = await service.listWindowsPrinters(fetch);

      expect(result).toEqual(process.platform === "win32" ? await fetch() : []);
    });
  });
});
