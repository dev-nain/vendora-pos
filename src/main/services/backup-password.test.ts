import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnauthenticatedError } from "../auth/errors";
import { createBackupKeyStore, type BackupKeyStore, type KeyProtector } from "../backup/backup-key";
import { auditLog, backupRecords } from "../db/schema";
import { createBackupPasswordService } from "./backup-password";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";

describe("createBackupPasswordService", () => {
  let kit: CheckoutKit;
  let keyFile: string;
  let keys: BackupKeyStore;
  let service: ReturnType<typeof createBackupPasswordService>;
  let available: boolean;
  let unprotectFails: boolean;

  const protector: KeyProtector = {
    available: async () => available,
    protect: async (secret) => Buffer.from(secret.split("").toReversed().join(""), "utf8"),
    unprotect: async (blob) => {
      if (unprotectFails) throw new Error("no keyring");
      return blob.toString("utf8").split("").toReversed().join("");
    },
  };

  const settingsAudit = () =>
    kit.database.db.select().from(auditLog).where(eq(auditLog.action, "settings_change")).all();

  beforeEach(() => {
    kit = createCheckoutKit();
    keyFile = join(kit.dir, "backup-key.json");
    available = true;
    unprotectFails = false;
    keys = createBackupKeyStore({ keyFile, protector });
    service = createBackupPasswordService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      keys,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    kit.close();
  });

  it("needs a session for every method", async () => {
    await expect(service.status()).rejects.toThrow(UnauthenticatedError);
    await expect(service.turnOn({ password: "blue horse 7" })).rejects.toThrow(
      UnauthenticatedError,
    );
    await expect(service.change({ current: "a", next: "blue horse 7" })).rejects.toThrow(
      UnauthenticatedError,
    );
    await expect(service.turnOff({ current: "a" })).rejects.toThrow(UnauthenticatedError);
    expect(existsSync(keyFile)).toBe(false);
  });

  it("starts off", async () => {
    kit.signIn("cashier");

    expect(await service.status()).toEqual({ state: "off" });
  });

  it("turns on, audits once, and then refuses a second turn on", async () => {
    const user = kit.signIn("cashier");

    expect(await service.turnOn({ password: "blue horse 7" })).toEqual({
      ok: true,
      status: { state: "on" },
    });
    expect(await service.turnOn({ password: "blue horse 7" })).toMatchObject({
      ok: false,
      reason: "already-on",
    });

    expect(settingsAudit()).toHaveLength(1);
    expect(settingsAudit()[0]).toMatchObject({
      actorUserId: user.id,
      entityType: "terminal",
      entityId: kit.terminalId,
    });
    expect(JSON.parse(settingsAudit()[0]!.details!)).toEqual({
      setting: "backupPassword",
      change: "turned_on",
    });
  });

  it("refuses to turn on when protection is unavailable and writes nothing", async () => {
    kit.signIn("cashier");
    available = false;

    const result = await service.turnOn({ password: "blue horse 7" });

    expect(result).toEqual({
      ok: false,
      reason: "protection-unavailable",
      message:
        "Windows can't protect the password on this PC, so it wasn't set. Nothing was changed.",
    });
    expect(existsSync(keyFile)).toBe(false);
    expect(settingsAudit()).toEqual([]);
  });

  it("gives two quick turn ons one audit row", async () => {
    kit.signIn("cashier");

    const results = await Promise.all([
      service.turnOn({ password: "blue horse 7" }),
      service.turnOn({ password: "green horse 8" }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toMatchObject([{ reason: "already-on" }]);
    expect(settingsAudit()).toHaveLength(1);
  });

  it("changes the password with a new salt and audits it", async () => {
    kit.signIn("cashier");
    await service.turnOn({ password: "blue horse 7" });
    const before = readFileSync(keyFile, "utf8");

    const result = await service.change({ current: "blue horse 7", next: "green horse 8" });

    expect(result).toEqual({ ok: true, status: { state: "on" } });
    const after = readFileSync(keyFile, "utf8");
    expect((JSON.parse(after) as { salt: string }).salt).not.toBe(
      (JSON.parse(before) as { salt: string }).salt,
    );
    expect(await keys.matches("green horse 8")).toBe(true);
    expect(await keys.matches("blue horse 7")).toBe(false);
    expect(JSON.parse(settingsAudit()[1]!.details!)).toEqual({
      setting: "backupPassword",
      change: "changed",
    });
  });

  it("refuses a wrong current password for change and turn off, changing nothing", async () => {
    kit.signIn("cashier");
    await service.turnOn({ password: "blue horse 7" });
    const before = readFileSync(keyFile, "utf8");

    const changed = await service.change({ current: "wrong guess", next: "green horse 8" });
    const off = await service.turnOff({ current: "wrong guess" });

    expect(changed).toMatchObject({ ok: false, reason: "wrong-password" });
    expect(off).toMatchObject({ ok: false, reason: "wrong-password" });
    expect(readFileSync(keyFile, "utf8")).toBe(before);
    expect(settingsAudit()).toHaveLength(1);
  });

  it("refuses change and turn off while the password is off", async () => {
    kit.signIn("cashier");

    expect(await service.change({ current: "x", next: "green horse 8" })).toMatchObject({
      reason: "already-off",
    });
    expect(await service.turnOff({ current: "x" })).toMatchObject({ reason: "already-off" });
  });

  it("turns off with the current password and removes the key file", async () => {
    kit.signIn("cashier");
    await service.turnOn({ password: "blue horse 7" });

    const result = await service.turnOff({ current: "blue horse 7" });

    expect(result).toEqual({ ok: true, status: { state: "off" } });
    expect(existsSync(keyFile)).toBe(false);
    expect(JSON.parse(settingsAudit()[1]!.details!)).toEqual({
      setting: "backupPassword",
      change: "turned_off",
    });
  });

  it("changes and turns off even when the protected key can't be read", async () => {
    kit.signIn("cashier");
    await service.turnOn({ password: "blue horse 7" });
    unprotectFails = true;
    expect(await service.status()).toEqual({ state: "unreadable" });

    const changed = await service.change({ current: "blue horse 7", next: "green horse 8" });
    expect(changed).toEqual({ ok: true, status: { state: "unreadable" } });

    unprotectFails = false;
    expect(await service.status()).toEqual({ state: "on" });

    unprotectFails = true;
    const off = await service.turnOff({ current: "green horse 8" });
    expect(off).toEqual({ ok: true, status: { state: "off" } });
  });

  it("rolls the audit row back when the key file can't be written", async () => {
    kit.signIn("cashier");
    const failing = createBackupKeyStore({
      keyFile,
      protector,
      renameFile: () => {
        throw new Error("disk full");
      },
    });
    const failingService = createBackupPasswordService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      keys: failing,
    });

    await expect(failingService.turnOn({ password: "blue horse 7" })).rejects.toThrow("disk full");

    expect(settingsAudit()).toEqual([]);
    expect(existsSync(keyFile)).toBe(false);
  });

  it("never lets a password or key reach logs, the audit log, backup records or the key file", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    kit.signIn("cashier");
    const marker = "marker-pw-9137";
    const next = "marker-next-5520";

    await service.turnOn({ password: marker });
    const key = await keys.seal();
    await service.change({ current: "marker-wrong-1", next });
    await service.change({ current: marker, next });
    await service.turnOff({ current: "marker-wrong-2" });
    const keyText = readFileSync(keyFile, "utf8");

    const secrets = [marker, next, "marker-wrong-1", "marker-wrong-2"];
    const keyForms = [
      Buffer.from(key?.key ?? []).toString("hex"),
      Buffer.from(key?.key ?? []).toString("base64"),
    ];
    const haystacks = [
      JSON.stringify(spies.flatMap((spy) => spy.mock.calls)),
      JSON.stringify(kit.database.db.select().from(auditLog).all()),
      JSON.stringify(kit.database.db.select().from(backupRecords).all()),
      keyText,
    ];
    for (const haystack of haystacks) {
      for (const secret of [...secrets, ...keyForms]) expect(haystack).not.toContain(secret);
    }
  });
});
