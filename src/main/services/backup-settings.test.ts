import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnauthenticatedError } from "../auth/errors";
import { createBackupService } from "../backup/backup-service";
import type { CopyDatabase } from "../backup/worker-copy";
import { auditLog } from "../db/schema";
import { createBackupSettingsService } from "./backup-settings";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";

const okCopy: CopyDatabase = async ({ tempFile }) => {
  writeFileSync(tempFile, "backup");
  return { sizeBytes: 6 };
};

describe("createBackupSettingsService", () => {
  let kit: CheckoutKit;
  let folder: string;
  let chooseFolder: ReturnType<typeof vi.fn<() => Promise<string | null>>>;
  let service: ReturnType<typeof createBackupSettingsService>;

  const settingsAudit = () =>
    kit.database.db.select().from(auditLog).where(eq(auditLog.action, "settings_change")).all();

  beforeEach(() => {
    kit = createCheckoutKit();
    folder = mkdtempSync(join(tmpdir(), "vendora-usb-"));
    chooseFolder = vi.fn(async () => folder);
    service = createBackupSettingsService({
      database: kit.database,
      audit: kit.audit,
      sessions: kit.sessions,
      chooseFolder,
    });
  });

  afterEach(() => {
    kit.close();
    rmSync(folder, { recursive: true, force: true });
  });

  it("throws for all three functions when signed out and never opens the dialog", async () => {
    expect(() => service.getSecondCopy()).toThrow(UnauthenticatedError);
    await expect(service.chooseSecondCopyFolder()).rejects.toThrow(UnauthenticatedError);
    expect(() => service.clearSecondCopyFolder()).toThrow(UnauthenticatedError);
    expect(chooseFolder).not.toHaveBeenCalled();
  });

  it("saves the chosen folder and audits from and to", async () => {
    const user = kit.signIn("cashier");

    const status = await service.chooseSecondCopyFolder();

    expect(status).toEqual({ folder, lastCopy: null });
    expect(settingsAudit()).toHaveLength(1);
    expect(settingsAudit()[0]).toMatchObject({ actorUserId: user.id, entityType: "terminal" });
    expect(JSON.parse(settingsAudit()[0]!.details!)).toEqual({
      setting: "secondCopyFolder",
      from: null,
      to: folder,
    });
  });

  it("changes nothing and audits nothing when the dialog is cancelled", async () => {
    kit.signIn("cashier");
    chooseFolder.mockResolvedValueOnce(null);

    expect(await service.chooseSecondCopyFolder()).toEqual({ folder: null, lastCopy: null });
    expect(settingsAudit()).toHaveLength(0);
  });

  it("audits nothing when the same folder is chosen again", async () => {
    kit.signIn("cashier");

    await service.chooseSecondCopyFolder();
    await service.chooseSecondCopyFolder();

    expect(settingsAudit()).toHaveLength(1);
  });

  it("clears the folder and audits it once", async () => {
    kit.signIn("cashier");
    await service.chooseSecondCopyFolder();

    expect(service.clearSecondCopyFolder()).toEqual({ folder: null, lastCopy: null });
    expect(service.clearSecondCopyFolder()).toEqual({ folder: null, lastCopy: null });

    expect(settingsAudit()).toHaveLength(2);
    expect(JSON.parse(settingsAudit()[1]!.details!)).toEqual({
      setting: "secondCopyFolder",
      from: folder,
      to: null,
    });
  });

  describe("with the backup service", () => {
    const t0 = new Date("2026-03-10T06:00:00Z").getTime();

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      vi.setSystemTime(t0);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows a failed copy's reason, then the next good copy replaces it", async () => {
      kit.signIn("cashier");
      await service.chooseSecondCopyFolder();
      const backups = createBackupService({
        database: kit.database,
        audit: kit.audit,
        backupDir: join(kit.dir, "backups"),
        copy: okCopy,
      });
      renameSync(folder, `${folder}-unplugged`);
      mkdirSync(`${folder}-unplugged`, { recursive: true });

      backups.runDailyIfDue();
      await backups.whenIdle();
      expect(service.getSecondCopy().lastCopy).toEqual({
        result: "failed",
        at: new Date(t0).toISOString(),
        reason: "Folder not found. If it's on a USB drive, plug it in.",
      });

      renameSync(`${folder}-unplugged`, folder);
      vi.setSystemTime(t0 + 24 * 60 * 60 * 1000);
      backups.runDailyIfDue();
      await backups.whenIdle();

      expect(service.getSecondCopy().lastCopy).toEqual({
        result: "ok",
        at: new Date(t0 + 24 * 60 * 60 * 1000).toISOString(),
      });
    });

    it("returns no last copy once the folder is cleared", async () => {
      kit.signIn("cashier");
      await service.chooseSecondCopyFolder();
      const backups = createBackupService({
        database: kit.database,
        audit: kit.audit,
        backupDir: join(kit.dir, "backups"),
        copy: okCopy,
      });
      backups.runDailyIfDue();
      await backups.whenIdle();
      expect(service.getSecondCopy().lastCopy).toMatchObject({ result: "ok" });

      expect(service.clearSecondCopyFolder().lastCopy).toBeNull();
    });
  });
});
