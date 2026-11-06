import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog, backupRecords, users } from "../db/schema";
import { createAuthService } from "../services/auth";
import { createCheckoutKit, type CheckoutKit } from "../services/checkout-test-kit";
import { createBackupService } from "./backup-service";
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
  const recordOf = (fileName: string) => records().find((record) => record.fileName === fileName)!;

  const createService = () =>
    createBackupService({ database: kit.database, audit: kit.audit, backupDir, copy });

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
