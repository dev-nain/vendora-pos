import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog, backupRecords, terminals, users } from "../db/schema";
import { createAuthService } from "../services/auth";
import { createCheckoutKit, type CheckoutKit } from "../services/checkout-test-kit";
import { createBackupService } from "./backup-service";
import type { CopyFile } from "./second-copy";
import type { CopyDatabase } from "./worker-copy";

function deferred<T = never>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const okCopy: CopyDatabase = async ({ tempFile }) => {
  await mkdir(join(tempFile, ".."), { recursive: true });
  await writeFile(tempFile, "backup");
  return { sizeBytes: 6 };
};

const hangUntilAborted: CopyFile = ({ signal }) =>
  new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () =>
      reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
    );
  });

const day = 24 * 60 * 60 * 1000;
const t0 = new Date("2026-03-10T06:00:00Z").getTime();

describe("createBackupService", () => {
  let kit: CheckoutKit;
  let backupDir: string;
  let copy: ReturnType<typeof vi.fn<CopyDatabase>>;

  const records = () => kit.database.db.select().from(backupRecords).all();
  const files = () => (existsSync(backupDir) ? readdirSync(backupDir).toSorted() : []);
  const backupAudit = () =>
    kit.database.db.select().from(auditLog).where(eq(auditLog.action, "backup")).all();

  const addOldRecord = (ageMs: number, fileName: string, withFile = true) => {
    if (withFile) {
      mkdirSync(backupDir, { recursive: true });
      writeFileSync(join(backupDir, fileName), "old");
    }
    kit.database.db
      .insert(backupRecords)
      .values({
        storeId: kit.storeId,
        terminalId: kit.terminalId,
        trigger: "daily",
        fileName,
        sizeBytes: 3,
        result: "ok",
        createdAt: new Date(t0 - ageMs),
      })
      .run();
  };
  const setFolder = (path: string | null) =>
    kit.database.db.update(terminals).set({ secondCopyFolder: path }).run();
  const recordOf = (fileName: string) => records().find((record) => record.fileName === fileName)!;

  const createService = (copyFile?: CopyFile) =>
    createBackupService({ database: kit.database, audit: kit.audit, backupDir, copy, copyFile });

  const runDailyAt = async (service: ReturnType<typeof createService>, at: number) => {
    vi.setSystemTime(at);
    service.runDailyIfDue();
    await service.whenIdle();
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(t0);
    kit = createCheckoutKit();
    backupDir = join(kit.dir, "backups");
    copy = vi.fn<CopyDatabase>(okCopy);
  });

  afterEach(() => {
    vi.useRealTimers();
    kit.close();
  });

  describe("daily trigger", () => {
    it("runs when there is no backup today and records it with a null actor", async () => {
      const service = createService();

      await runDailyAt(service, t0);

      const [record] = records();
      expect(records()).toHaveLength(1);
      expect(record).toMatchObject({
        trigger: "daily",
        result: "ok",
        sizeBytes: 6,
        error: null,
        deletedAt: null,
      });
      expect(record?.createdAt.getTime()).toBe(t0);
      expect(files()).toEqual([record?.fileName]);
      const [entry] = backupAudit();
      expect(backupAudit()).toHaveLength(1);
      expect(entry).toMatchObject({
        actorUserId: null,
        entityType: "backup",
        entityId: record?.id,
      });
      expect(JSON.parse(entry!.details!)).toEqual({
        trigger: "daily",
        fileName: record?.fileName,
        sizeBytes: 6,
        result: "ok",
      });
    });

    it("runs nothing when an ok record exists for today", async () => {
      const service = createService();

      await runDailyAt(service, t0);
      await runDailyAt(service, t0 + 60 * 60 * 1000);

      expect(records()).toHaveLength(1);
    });

    it("retries after a failed attempt at the next check", async () => {
      const service = createService();
      copy.mockRejectedValueOnce(new Error("disk full"));

      await runDailyAt(service, t0);
      expect(records().map((record) => record.result)).toEqual(["failed"]);
      await runDailyAt(service, t0 + 60 * 60 * 1000);

      expect(records().map((record) => record.result)).toEqual(["failed", "ok"]);
    });

    it("runs again once the Karachi day changes while the app stays open", async () => {
      const service = createService();

      await runDailyAt(service, t0);
      await runDailyAt(service, t0 + day);

      expect(records()).toHaveLength(2);
    });

    it("treats 23:59 and 00:00 Karachi as different days within one UTC day", async () => {
      const service = createService();
      const lateKarachi = new Date("2026-03-10T18:59:00Z").getTime();
      const midnightKarachi = new Date("2026-03-10T19:00:00Z").getTime();

      await runDailyAt(service, lateKarachi);
      await runDailyAt(service, lateKarachi + 30_000);
      expect(records()).toHaveLength(1);
      await runDailyAt(service, midnightKarachi);

      expect(records()).toHaveLength(2);
    });
  });

  describe("attempt", () => {
    it("holds only the temp file while the copy is pending", async () => {
      const gate = deferred<void>();
      copy.mockImplementationOnce(async (job) => {
        await okCopy(job);
        await gate.promise;
        return { sizeBytes: 6 };
      });
      const service = createService();

      service.runDailyIfDue();
      await vi.waitFor(() => expect(files()).toHaveLength(1));
      expect(files()[0]).toMatch(/^vendora-.*\.db\.tmp$/);
      gate.resolve();
      await service.whenIdle();

      expect(files()[0]).toMatch(/^vendora-.*\.db$/);
      expect(files()).toHaveLength(1);
    });

    it("records a failed copy with the error, leaves no file and audits it", async () => {
      copy.mockImplementationOnce(async (job) => {
        await okCopy(job);
        throw new Error("x".repeat(600));
      });
      const service = createService();

      await runDailyAt(service, t0);

      const [record] = records();
      expect(record).toMatchObject({ result: "failed", sizeBytes: null });
      expect(record?.error).toHaveLength(500);
      expect(files()).toEqual([]);
      const details = JSON.parse(backupAudit()[0]!.details!) as Record<string, unknown>;
      expect(details).toMatchObject({ result: "failed", sizeBytes: null });
      expect(JSON.stringify(details)).not.toContain("xxx");
    });

    it("keeps selling while a copy is pending and after one fails", async () => {
      kit.signIn("cashier");
      kit.openShift();
      const product = kit.addProduct();
      const pending = deferred();
      copy.mockImplementationOnce(() => pending.promise);
      const service = createService();
      const sell = () => {
        const added = kit.billDrafts.addProduct({ productId: product.id, qtyMilli: 1000 });
        if (!added.ok) throw new Error("add failed");
        return kit.sales.complete({
          draftId: added.bill.id,
          payments: [{ method: "cash", amountPaisa: 100_000 }],
        });
      };

      service.runDailyIfDue();
      await vi.waitFor(() => expect(copy).toHaveBeenCalled());
      expect(sell().ok).toBe(true);
      pending.reject(new Error("locked"));
      await service.whenIdle();
      expect(records()[0]?.result).toBe("failed");
      expect(sell().ok).toBe(true);
    });

    it("runs no retention after a failed attempt", async () => {
      const service = createService();
      await runDailyAt(service, t0);
      copy.mockRejectedValueOnce(new Error("disk full"));

      await runDailyAt(service, t0 + 45 * day);

      expect(records().filter((record) => record.deletedAt === null)).toHaveLength(2);
      expect(files()).toHaveLength(1);
    });

    it("does not reject the chain when the audit write fails", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const service = createService();
      vi.spyOn(kit.audit, "record").mockImplementation(() => {
        throw new Error("audit down");
      });

      await runDailyAt(service, t0);
      vi.restoreAllMocks();
      await runDailyAt(service, t0 + day);

      expect(records()).toHaveLength(1);
      expect(error).toHaveBeenCalled();
    });
  });

  describe("retention", () => {
    it("keeps a backup that is exactly 30 days old", async () => {
      addOldRecord(30 * day, "vendora-exact.db");

      await runDailyAt(createService(), t0);

      expect(files()).toContain("vendora-exact.db");
      expect(recordOf("vendora-exact.db").deletedAt).toBeNull();
    });

    it("deletes a backup 30 days and 1 ms old and marks its record", async () => {
      addOldRecord(30 * day + 1, "vendora-expired.db");

      await runDailyAt(createService(), t0);

      expect(files()).not.toContain("vendora-expired.db");
      expect(recordOf("vendora-expired.db").deletedAt?.getTime()).toBe(t0);
    });

    it("keeps the newest good backup however old it is", async () => {
      addOldRecord(60 * day, "vendora-older.db");
      copy.mockImplementationOnce(async (job) => {
        vi.setSystemTime(t0 + 45 * day);
        return okCopy(job);
      });

      await runDailyAt(createService(), t0);

      const fresh = records().find((record) => record.trigger === "daily" && !record.deletedAt)!;
      expect(files()).toContain(fresh.fileName);
      expect(files()).not.toContain("vendora-older.db");
    });

    it("marks an expired record whose file is already gone", async () => {
      addOldRecord(40 * day, "vendora-gone.db", false);

      await runDailyAt(createService(), t0);

      expect(recordOf("vendora-gone.db").deletedAt).not.toBeNull();
    });

    it("ignores failed records", async () => {
      kit.database.db
        .insert(backupRecords)
        .values({
          storeId: kit.storeId,
          terminalId: kit.terminalId,
          trigger: "daily",
          fileName: "vendora-failed.db",
          result: "failed",
          error: "disk full",
          createdAt: new Date(t0 - 40 * day),
        })
        .run();

      await runDailyAt(createService(), t0);

      expect(recordOf("vendora-failed.db").deletedAt).toBeNull();
    });

    it("leaves the row alone when the file cannot be removed and the attempt stays ok", async () => {
      addOldRecord(40 * day, "vendora-stuck.db", false);
      mkdirSync(join(backupDir, "vendora-stuck.db"), { recursive: true });

      await runDailyAt(createService(), t0);

      expect(recordOf("vendora-stuck.db").deletedAt).toBeNull();
      expect(records().filter((record) => record.result === "ok")).toHaveLength(2);
    });

    it("never touches pre-migrate backups or unknown files", async () => {
      mkdirSync(backupDir, { recursive: true });
      writeFileSync(join(backupDir, "pre-migrate-2020-01-01T00-00-00-000Z.db"), "m");
      writeFileSync(join(backupDir, "notes.txt"), "n");
      addOldRecord(40 * day, "vendora-expired.db");

      await runDailyAt(createService(), t0);

      expect(files()).toContain("pre-migrate-2020-01-01T00-00-00-000Z.db");
      expect(files()).toContain("notes.txt");
    });
  });

  describe("actor", () => {
    it("adds no user row and leaves first-run setup available", async () => {
      const service = createService();

      await runDailyAt(service, t0);

      expect(kit.database.db.select().from(users).all()).toHaveLength(0);
      const auth = createAuthService({
        database: kit.database,
        audit: kit.audit,
        sessions: kit.sessions,
      });
      expect(auth.needsSetup()).toBe(true);
    });
  });
  describe("start and stop", () => {
    it("removes leftover temp files before the first backup and nothing else", async () => {
      mkdirSync(backupDir, { recursive: true });
      writeFileSync(join(backupDir, "vendora-2020-01-01T00-00-00-000Z.db.tmp"), "partial");
      writeFileSync(join(backupDir, "pre-migrate-2020-01-01T00-00-00-000Z.db"), "m");
      writeFileSync(join(backupDir, "other.tmp"), "o");
      const service = createService();

      service.start();
      await service.whenIdle();
      await service.stop();

      expect(files()).not.toContain("vendora-2020-01-01T00-00-00-000Z.db.tmp");
      expect(files()).toContain("pre-migrate-2020-01-01T00-00-00-000Z.db");
      expect(files()).toContain("other.tmp");
      expect(records()).toHaveLength(1);
    });

    it("starts without a backup folder", async () => {
      const service = createService();

      service.start();
      await service.whenIdle();
      await service.stop();

      expect(existsSync(backupDir)).toBe(true);
    });

    it("checks again every hour until stopped", async () => {
      const service = createService();
      service.start();
      await service.whenIdle();

      vi.setSystemTime(t0 + day);
      vi.advanceTimersByTime(60 * 60 * 1000);
      await service.whenIdle();
      expect(records()).toHaveLength(2);

      await service.stop();
      vi.setSystemTime(t0 + 2 * day);
      vi.advanceTimersByTime(60 * 60 * 1000);
      await service.whenIdle();
      expect(records()).toHaveLength(2);
    });

    it("aborts a hung copy after the quit wait and records a failure", async () => {
      vi.useFakeTimers({
        toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
      });
      vi.setSystemTime(t0);
      copy.mockImplementationOnce(
        ({ signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("Backup was cancelled")));
          }),
      );
      const service = createService();
      service.runDailyIfDue();
      await vi.waitFor(() => expect(copy).toHaveBeenCalled());

      const stopped = service.stop();
      await vi.advanceTimersByTimeAsync(60_000);
      await stopped;

      expect(records()).toHaveLength(1);
      expect(records()[0]).toMatchObject({ result: "failed", error: "Backup was cancelled" });
    });
  });
  describe("second copy", () => {
    let folder: string;
    const folderFiles = () => (existsSync(folder) ? readdirSync(folder).toSorted() : []);
    const addOldCopy = (ageMs: number, fileName: string, inFolder = folder, withFile = true) => {
      if (withFile) writeFileSync(join(inFolder, fileName), "old");
      kit.database.db
        .insert(backupRecords)
        .values({
          storeId: kit.storeId,
          terminalId: kit.terminalId,
          trigger: "daily",
          fileName,
          sizeBytes: 3,
          result: "ok",
          copyFolder: inFolder,
          copyResult: "ok",
          createdAt: new Date(t0 - ageMs),
        })
        .run();
    };

    beforeEach(() => {
      folder = join(kit.dir, "usb");
      mkdirSync(folder);
      setFolder(folder);
    });

    it("copies the daily backup into the folder", async () => {
      await runDailyAt(createService(), t0);

      const [record] = records();
      expect(record).toMatchObject({
        result: "ok",
        copyFolder: folder,
        copyResult: "ok",
        copyError: null,
      });
      expect(folderFiles()).toEqual([record?.fileName]);
    });

    it("copies a backup started with a user id", async () => {
      const user = kit.signIn("cashier");
      const service = createService();

      service.afterShiftClose(user.id);
      await service.whenIdle();

      expect(records()[0]).toMatchObject({ trigger: "shift_close", copyResult: "ok" });
      expect(folderFiles()).toHaveLength(1);
    });

    it("makes no copy when no folder is set", async () => {
      setFolder(null);

      await runDailyAt(createService(), t0);

      expect(records()[0]).toMatchObject({
        result: "ok",
        copyFolder: null,
        copyResult: null,
        copyError: null,
      });
      expect(folderFiles()).toEqual([]);
    });

    it("keeps the backup ok and saves the reason when the folder is missing", async () => {
      renameSync(folder, `${folder}-unplugged`);

      await runDailyAt(createService(), t0);

      const [record] = records();
      expect(record).toMatchObject({
        result: "ok",
        copyResult: "failed",
        copyError: "Folder not found. If it's on a USB drive, plug it in.",
      });
      expect(files()).toEqual([record?.fileName]);
      expect(existsSync(folder)).toBe(false);
    });

    it("keeps the backup ok and saves the reason when the disk is full", async () => {
      const service = createService(({ tempFile }) => {
        writeFileSync(tempFile, "part");
        return Promise.reject(Object.assign(new Error("full"), { code: "ENOSPC" }));
      });

      await runDailyAt(service, t0);

      expect(records()[0]).toMatchObject({
        result: "ok",
        copyResult: "failed",
        copyError: "Not enough free space in the folder.",
      });
      expect(folderFiles()).toEqual([]);
    });

    it("runs no copy after a failed backup", async () => {
      const copyFile = vi.fn<CopyFile>();
      copy.mockRejectedValueOnce(new Error("disk full"));

      await runDailyAt(createService(copyFile), t0);

      expect(records()[0]).toMatchObject({ result: "failed", copyFolder: null, copyResult: null });
      expect(copyFile).not.toHaveBeenCalled();
    });

    it("tries again with the next backup once the folder is back", async () => {
      const service = createService();
      renameSync(folder, `${folder}-unplugged`);
      await runDailyAt(service, t0);
      renameSync(`${folder}-unplugged`, folder);

      await runDailyAt(service, t0 + day);

      expect(records().map((record) => record.copyResult)).toEqual(["failed", "ok"]);
      expect(folderFiles()).toEqual([records()[1]?.fileName]);
    });

    it("deletes a copy past 30 days and marks it", async () => {
      addOldCopy(30 * day + 1, "vendora-expired.db");

      await runDailyAt(createService(), t0);

      expect(folderFiles()).not.toContain("vendora-expired.db");
      expect(recordOf("vendora-expired.db").copyDeletedAt?.getTime()).toBe(t0);
    });

    it("keeps a copy that is 29 days old", async () => {
      addOldCopy(29 * day, "vendora-recent.db");

      await runDailyAt(createService(), t0);

      expect(folderFiles()).toContain("vendora-recent.db");
      expect(recordOf("vendora-recent.db").copyDeletedAt).toBeNull();
    });

    it("keeps the newest good copy however old it is", async () => {
      addOldCopy(60 * day, "vendora-older.db");
      copy.mockImplementationOnce(async (job) => {
        vi.setSystemTime(t0 + 45 * day);
        return okCopy(job);
      });

      await runDailyAt(createService(), t0);

      const fresh = records().find((record) => record.trigger === "daily" && !record.deletedAt)!;
      expect(folderFiles()).toContain(fresh.fileName);
      expect(folderFiles()).not.toContain("vendora-older.db");
    });

    it("never touches files that have no record", async () => {
      writeFileSync(join(folder, "notes.txt"), "n");
      writeFileSync(join(folder, "vendora-2020-01-01T00-00-00-000Z.db"), "x");
      writeFileSync(join(folder, "vendora-2020-01-01T00-00-00-000Z.db.tmp"), "x");
      addOldCopy(40 * day, "vendora-expired.db");

      await runDailyAt(createService(), t0);

      expect(folderFiles()).toContain("notes.txt");
      expect(folderFiles()).toContain("vendora-2020-01-01T00-00-00-000Z.db");
      expect(folderFiles()).toContain("vendora-2020-01-01T00-00-00-000Z.db.tmp");
      expect(folderFiles()).not.toContain("vendora-expired.db");
    });

    it("deletes nothing for a row whose copy failed", async () => {
      addOldCopy(40 * day, "vendora-failed-copy.db");
      kit.database.db
        .update(backupRecords)
        .set({ copyResult: "failed", copyError: "x" })
        .where(eq(backupRecords.fileName, "vendora-failed-copy.db"))
        .run();

      await runDailyAt(createService(), t0);

      expect(folderFiles()).toContain("vendora-failed-copy.db");
      expect(recordOf("vendora-failed-copy.db").copyDeletedAt).toBeNull();
    });

    it("expires a copy in a previous folder after the folder changes", async () => {
      const previous = join(kit.dir, "old-usb");
      mkdirSync(previous);
      addOldCopy(40 * day, "vendora-expired.db", previous);

      await runDailyAt(createService(), t0);

      expect(readdirSync(previous)).toEqual([]);
      expect(recordOf("vendora-expired.db").copyDeletedAt).not.toBeNull();
    });

    it("leaves the row unmarked while the folder is unreachable, then deletes the file", async () => {
      addOldCopy(40 * day, "vendora-expired.db");
      renameSync(folder, `${folder}-unplugged`);
      const service = createService();

      await runDailyAt(service, t0);
      expect(recordOf("vendora-expired.db").copyDeletedAt).toBeNull();
      renameSync(`${folder}-unplugged`, folder);
      await runDailyAt(service, t0 + day);

      expect(folderFiles()).not.toContain("vendora-expired.db");
      expect(recordOf("vendora-expired.db").copyDeletedAt).not.toBeNull();
    });

    it("recovers an interrupted copy on start", async () => {
      writeFileSync(join(folder, "vendora-cut.db.tmp"), "partial");
      writeFileSync(join(folder, "vendora-other.db.tmp"), "other");
      kit.database.db
        .insert(backupRecords)
        .values({
          storeId: kit.storeId,
          terminalId: kit.terminalId,
          trigger: "daily",
          fileName: "vendora-cut.db",
          sizeBytes: 3,
          result: "ok",
          copyFolder: folder,
          createdAt: new Date(t0 - day),
        })
        .run();
      const service = createService();

      service.start();
      await service.whenIdle();
      await service.stop();

      expect(folderFiles()).not.toContain("vendora-cut.db.tmp");
      expect(folderFiles()).toContain("vendora-other.db.tmp");
      expect(recordOf("vendora-cut.db")).toMatchObject({
        copyResult: "failed",
        copyError: "Vendora closed before the copy finished.",
      });
    });

    it("aborts a slow copy on stop and records the failure", async () => {
      vi.useFakeTimers({
        toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
      });
      vi.setSystemTime(t0);
      const service = createService(hangUntilAborted);
      service.runDailyIfDue();
      await vi.waitFor(() => expect(records()).toHaveLength(1));

      const stopped = service.stop();
      await vi.advanceTimersByTimeAsync(60_000);
      await stopped;

      expect(records()[0]).toMatchObject({
        result: "ok",
        copyResult: "failed",
        copyError: "Vendora closed before the copy finished.",
      });
    });
  });

  describe("shift close trigger", () => {
    it("records the closing user and the shift_close trigger", async () => {
      const user = kit.signIn("cashier");
      const service = createService();

      service.afterShiftClose(user.id);
      await service.whenIdle();

      expect(records()[0]).toMatchObject({ trigger: "shift_close", result: "ok" });
      expect(backupAudit()[0]?.actorUserId).toBe(user.id);
    });

    it("satisfies the daily backup for the same day", async () => {
      const user = kit.signIn("cashier");
      const service = createService();

      service.afterShiftClose(user.id);
      await runDailyAt(service, t0 + 60 * 60 * 1000);

      expect(records()).toHaveLength(1);
    });

    it("gets its own attempt after a running copy and never overlaps", async () => {
      const user = kit.signIn("cashier");
      const gate = deferred<void>();
      let running = 0;
      let overlapped = false;
      copy.mockImplementation(async (job) => {
        running += 1;
        overlapped ||= running > 1;
        await gate.promise;
        await okCopy(job);
        running -= 1;
        return { sizeBytes: 6 };
      });
      const service = createService();

      service.runDailyIfDue();
      await vi.waitFor(() => expect(copy).toHaveBeenCalledTimes(1));
      service.afterShiftClose(user.id);
      vi.setSystemTime(t0 + 1000);
      gate.resolve();
      await service.whenIdle();

      expect(copy).toHaveBeenCalledTimes(2);
      expect(overlapped).toBe(false);
      expect(records().map((record) => record.trigger)).toEqual(["daily", "shift_close"]);
    });

    it("finishes a queued shift close during stop", async () => {
      const user = kit.signIn("cashier");
      const service = createService();

      service.afterShiftClose(user.id);
      await service.stop();

      expect(records()).toHaveLength(1);
      expect(files()).toHaveLength(1);
    });

    it("skips queued daily runs once stopping", async () => {
      const service = createService();

      const stopped = service.stop();
      service.runDailyIfDue();
      await stopped;
      await service.whenIdle();

      expect(records()).toHaveLength(0);
    });

    it("does not throw when the record cannot be written", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const user = kit.signIn("cashier");
      const service = createService();
      vi.spyOn(kit.audit, "record").mockImplementation(() => {
        throw new Error("audit down");
      });

      expect(() => service.afterShiftClose(user.id)).not.toThrow();
      await service.whenIdle();

      expect(error).toHaveBeenCalled();
    });
  });
});
