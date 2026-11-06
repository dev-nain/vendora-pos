import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnauthenticatedError } from "../auth/errors";
import { backupRecords } from "../db/schema";
import type { BackupService } from "../backup/backup-service";
import { restoreMessages, type RestoreService } from "../backup/restore";
import { createCheckoutKit, type CheckoutKit } from "./checkout-test-kit";
import { createBackupAdminService, restoreBlocker } from "./backup-admin";

const goodName = "vendora-2026-11-05T10-00-00-000Z.db";

describe("backup admin service", () => {
  let kit: CheckoutKit;
  let backupDir: string;
  let backupNow: ReturnType<typeof vi.fn<BackupService["backupNow"]>>;
  let restore: ReturnType<typeof vi.fn<RestoreService["restore"]>>;
  let chooseFile: ReturnType<typeof vi.fn<() => Promise<string | null>>>;

  const createService = () =>
    createBackupAdminService({
      database: kit.database,
      sessions: kit.sessions,
      backups: { backupNow },
      restores: { restore },
      shifts: kit.shifts,
      backupDir,
      chooseFile,
    });

  const addBackupFile = (name: string) => {
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(join(backupDir, name), "data");
  };

  const hold = () => {
    const added = kit.billDrafts.addProduct({
      productId: kit.addProduct().id,
      qtyMilli: 1000,
    });
    if (!added.ok) throw new Error("add failed");
    kit.billDrafts.hold({ draftId: added.bill.id });
  };

  const addFailure = (at: number, error: string) =>
    kit.database.db
      .insert(backupRecords)
      .values({
        storeId: kit.storeId,
        terminalId: kit.terminalId,
        trigger: "daily",
        fileName: "vendora-failed.db",
        sizeBytes: null,
        result: "failed",
        error,
        createdAt: new Date(at),
      })
      .run();

  beforeEach(() => {
    kit = createCheckoutKit();
    backupDir = join(kit.dir, "backups");
    backupNow = vi.fn<BackupService["backupNow"]>(async () => ({ ok: true, fileName: "x" }));
    restore = vi.fn<RestoreService["restore"]>(async () => ({ ok: true }));
    chooseFile = vi.fn(async () => null);
  });

  afterEach(() => {
    kit.close();
  });

  describe("restoreBlocker", () => {
    it("is null while the shift is closed", () => {
      kit.signIn("cashier");

      expect(restoreBlocker(kit.shifts.state())).toBeNull();
    });

    it("asks to close an open shift", () => {
      kit.signIn("cashier");
      kit.openShift();

      expect(restoreBlocker(kit.shifts.state())).toBe("Close the shift before restoring.");
    });

    it("names one held bill and several", () => {
      kit.signIn("cashier");
      kit.openShift();
      hold();
      expect(restoreBlocker(kit.shifts.state())).toBe(
        "Close the shift and clear 1 bill on hold before restoring.",
      );

      hold();
      expect(restoreBlocker(kit.shifts.state())).toBe(
        "Close the shift and clear 2 bills on hold before restoring.",
      );
    });
  });

  describe("status", () => {
    it("reads the last backup from the files and ignores records", async () => {
      kit.signIn("cashier");
      addBackupFile(goodName);
      addBackupFile("vendora-2026-11-04T10-00-00-000Z.db");
      kit.database.db
        .insert(backupRecords)
        .values({
          storeId: kit.storeId,
          terminalId: kit.terminalId,
          trigger: "daily",
          fileName: "vendora-2030-01-01T00-00-00-000Z.db",
          sizeBytes: 1,
          result: "ok",
          createdAt: new Date("2030-01-01T00:00:00Z"),
        })
        .run();

      const status = await createService().status();

      expect(status.lastBackupAt).toBe("2026-11-05T10:00:00.000Z");
      expect(status.backups.map((file) => file.fileName)).toEqual([
        goodName,
        "vendora-2026-11-04T10-00-00-000Z.db",
      ]);
      expect(status.lastFailure).toBeNull();
      expect(status.restoreBlock).toBeNull();
    });

    it("reports a failure only when it is newer than the newest file", async () => {
      kit.signIn("cashier");
      addBackupFile(goodName);
      addFailure(Date.parse("2026-11-05T09:00:00Z"), "older failure");
      expect((await createService().status()).lastFailure).toBeNull();

      addFailure(Date.parse("2026-11-06T09:00:00Z"), "disk full");

      expect((await createService().status()).lastFailure).toEqual({
        at: "2026-11-06T09:00:00.000Z",
        reason: "disk full",
      });
    });

    it("reports a failure when there are no files", async () => {
      kit.signIn("cashier");
      addFailure(Date.parse("2026-11-06T09:00:00Z"), "disk full");

      const status = await createService().status();

      expect(status.lastBackupAt).toBeNull();
      expect(status.lastFailure?.reason).toBe("disk full");
    });

    it("sets restoreBlock while a shift is open", async () => {
      kit.signIn("cashier");
      kit.openShift();

      expect((await createService().status()).restoreBlock).toBe(
        "Close the shift before restoring.",
      );
    });
  });

  describe("backupNow", () => {
    it("backs up as the signed-in user", async () => {
      const user = kit.signIn("cashier");

      expect(await createService().backupNow()).toEqual({ ok: true });
      expect(backupNow).toHaveBeenCalledWith(user.id);
    });

    it("reports a failure with its error", async () => {
      kit.signIn("cashier");
      backupNow.mockResolvedValueOnce({ ok: false, error: "disk full" });

      expect(await createService().backupNow()).toEqual({
        ok: false,
        message: "Backup failed: disk full",
      });
    });
  });

  describe("restore", () => {
    it("is refused while a shift is open, without calling the restore", async () => {
      kit.signIn("cashier");
      kit.openShift();
      addBackupFile(goodName);

      const result = await createService().restore({ kind: "listed", fileName: goodName });

      expect(result).toEqual({
        ok: false,
        reason: "open-work",
        message: "Close the shift before restoring.",
      });
      expect(restore).not.toHaveBeenCalled();
    });

    it("is refused with held bills", async () => {
      kit.signIn("cashier");
      kit.openShift();
      hold();
      addBackupFile(goodName);

      const result = await createService().restore({ kind: "listed", fileName: goodName });

      expect(result).toMatchObject({
        reason: "open-work",
        message: "Close the shift and clear 1 bill on hold before restoring.",
      });
      expect(restore).not.toHaveBeenCalled();
    });

    it("answers not-found for a listed name that is not in the folder", async () => {
      kit.signIn("cashier");

      const result = await createService().restore({ kind: "listed", fileName: goodName });

      expect(result).toEqual({
        ok: false,
        reason: "not-found",
        message: restoreMessages["not-found"],
      });
      expect(restore).not.toHaveBeenCalled();
    });

    it("restores a listed backup as the signed-in user", async () => {
      const user = kit.signIn("cashier");
      addBackupFile(goodName);

      const result = await createService().restore({ kind: "listed", fileName: goodName });

      expect(result).toEqual({ ok: true });
      expect(restore).toHaveBeenCalledWith(
        {
          file: join(backupDir, goodName),
          fileName: goodName,
          takenAt: "2026-11-05T10:00:00.000Z",
        },
        { userId: user.id, displayName: "cashier name" },
      );
    });

    it("restores a picked file once and rejects a wrong or reused token", async () => {
      kit.signIn("cashier");
      const picked = join(kit.dir, "note.db");
      writeFileSync(picked, "x");
      utimesSync(picked, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z"));
      chooseFile.mockResolvedValueOnce(picked);
      const service = createService();

      const chosen = await service.chooseRestoreFile();

      expect(chosen).toMatchObject({ fileName: "note.db", takenAt: "2026-10-01T00:00:00.000Z" });
      const wrong = await service.restore({
        kind: "picked",
        token: "018f0000-0000-7000-8000-000000000000",
      });
      expect(wrong).toMatchObject({ ok: false, reason: "not-found" });

      chooseFile.mockResolvedValueOnce(picked);
      const second = await service.chooseRestoreFile();
      expect(await service.restore({ kind: "picked", token: second!.token })).toEqual({ ok: true });
      expect(restore.mock.calls[0]?.[0]).toMatchObject({ file: picked, fileName: "note.db" });
      expect(await service.restore({ kind: "picked", token: second!.token })).toMatchObject({
        reason: "not-found",
      });
      expect(restore).toHaveBeenCalledTimes(1);
    });

    it("takes the date of a picked backup from its name", async () => {
      kit.signIn("cashier");
      const picked = join(kit.dir, goodName);
      writeFileSync(picked, "x");
      chooseFile.mockResolvedValueOnce(picked);

      const chosen = await createService().chooseRestoreFile();

      expect(chosen?.takenAt).toBe("2026-11-05T10:00:00.000Z");
    });

    it("returns null when the dialog is cancelled", async () => {
      kit.signIn("cashier");

      expect(await createService().chooseRestoreFile()).toBeNull();
    });
  });

  describe("without a session", () => {
    it("throws on every action", async () => {
      const service = createService();

      await expect(service.status()).rejects.toBeInstanceOf(UnauthenticatedError);
      await expect(service.backupNow()).rejects.toBeInstanceOf(UnauthenticatedError);
      await expect(service.chooseRestoreFile()).rejects.toBeInstanceOf(UnauthenticatedError);
      await expect(service.restore({ kind: "listed", fileName: goodName })).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
      expect(chooseFile).not.toHaveBeenCalled();
    });

    it("rechecks the session after the dialog", async () => {
      kit.signIn("cashier");
      const picked = join(kit.dir, "note.db");
      writeFileSync(picked, "x");
      chooseFile.mockImplementationOnce(async () => {
        kit.sessions.end();
        return picked;
      });

      await expect(createService().chooseRestoreFile()).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
    });
  });
});
