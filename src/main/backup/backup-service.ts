import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { VendoraDatabase } from "../db/client";
import { backupRecords, type BackupTrigger } from "../db/schema";
import { currentTerminal } from "../db/terminal";
import { backupStamp } from "../db/vacuum-into";
import type { createAuditService } from "../services/audit";
import type { CopyDatabase } from "./worker-copy";

const retentionMs = 30 * 24 * 60 * 60 * 1000;
const dailyCheckMs = 60 * 60 * 1000;
const quitWaitMs = 60 * 1000;
const maxErrorLength = 500;
const tempFilePattern = /^(vendora|pre-restore)-.*\.db\.tmp$/;

const karachiDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" });

export type BackupAttempt = { ok: true; fileName: string } | { ok: false; error: string };

interface BackupServiceDeps {
  database: VendoraDatabase;
  audit: ReturnType<typeof createAuditService>;
  backupDir: string;
  copy: CopyDatabase;
  now?: () => Date;
}

export function createBackupService({
  database,
  audit,
  backupDir,
  copy,
  now = () => new Date(),
}: BackupServiceDeps) {
  const { db } = database;
  const abort = new AbortController();
  let chain: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopping: Promise<void> | null = null;

  function enqueue(task: () => Promise<void>): void {
    chain = chain.then(task).catch((error: unknown) => {
      console.error("Backup task failed:", error instanceof Error ? error.message : String(error));
    });
  }

  function enqueueForResult<T>(task: () => Promise<T>): Promise<T> {
    const result = chain.then(task);
    chain = result.then(
      () => undefined,
      (error: unknown) => {
        console.error(
          "Backup task failed:",
          error instanceof Error ? error.message : String(error),
        );
      },
    );
    return result;
  }

  async function whenIdle(): Promise<void> {
    let seen: Promise<void>;
    do {
      seen = chain;
      await seen;
    } while (seen !== chain);
  }

  async function removeExpired(): Promise<void> {
    const rows = db
      .select()
      .from(backupRecords)
      .where(and(eq(backupRecords.result, "ok"), isNull(backupRecords.deletedAt)))
      .orderBy(desc(backupRecords.createdAt))
      .all();

    let newestGoodId: string | null = null;
    for (const row of rows) {
      const exists = await stat(join(backupDir, basename(row.fileName))).then(
        () => true,
        () => false,
      );
      if (exists) {
        newestGoodId = row.id;
        break;
      }
    }

    const current = now().getTime();
    for (const row of rows) {
      if (row.id === newestGoodId) continue;
      if (current - row.createdAt.getTime() <= retentionMs) continue;
      try {
        await rm(join(backupDir, basename(row.fileName)), { force: true });
        db.update(backupRecords)
          .set({ deletedAt: now() })
          .where(eq(backupRecords.id, row.id))
          .run();
      } catch {
        continue;
      }
    }
  }

  async function attempt(
    trigger: BackupTrigger,
    actorUserId: string | null,
  ): Promise<BackupAttempt> {
    const startedAt = now();
    const prefix = trigger === "pre_restore" ? "pre-restore" : "vendora";
    const fileName = `${prefix}-${backupStamp(startedAt)}.db`;
    const finalFile = join(backupDir, fileName);
    const tempFile = `${finalFile}.tmp`;

    let sizeBytes: number | null = null;
    let error: string | null = null;
    try {
      await mkdir(backupDir, { recursive: true });
      const copied = await copy({
        sourceFile: database.sqlite.name,
        tempFile,
        signal: abort.signal,
      });
      await rename(tempFile, finalFile);
      sizeBytes = copied.sizeBytes;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      error = (message || "Backup failed").slice(0, maxErrorLength);
      await rm(tempFile, { force: true }).catch(() => undefined);
    }

    const result = error === null ? "ok" : "failed";
    try {
      db.transaction((tx) => {
        const terminal = currentTerminal(tx);
        const record = tx
          .insert(backupRecords)
          .values({
            storeId: terminal.storeId,
            terminalId: terminal.id,
            trigger,
            fileName,
            sizeBytes,
            result,
            error,
            createdAt: startedAt,
            updatedAt: now(),
          })
          .returning({ id: backupRecords.id })
          .get();
        audit.record(
          {
            action: "backup",
            actorUserId,
            entityType: "backup",
            entityId: record.id,
            details: { trigger, fileName, sizeBytes, result },
          },
          tx,
        );
      });
    } catch (cause) {
      console.error(
        "Backup record failed:",
        cause instanceof Error ? cause.message : String(cause),
      );
      return error === null ? { ok: true, fileName } : { ok: false, error };
    }

    if (error !== null) return { ok: false, error };
    await removeExpired();
    return { ok: true, fileName };
  }

  function backedUpToday(): boolean {
    const latest = db
      .select({ createdAt: backupRecords.createdAt })
      .from(backupRecords)
      .where(eq(backupRecords.result, "ok"))
      .orderBy(desc(backupRecords.createdAt))
      .limit(1)
      .get();
    return latest !== undefined && karachiDay.format(latest.createdAt) === karachiDay.format(now());
  }

  async function sweepTempFiles(): Promise<void> {
    const names = await readdir(backupDir).catch(() => []);
    await Promise.all(
      names
        .filter((name) => tempFilePattern.test(name))
        .map((name) => rm(join(backupDir, name), { force: true }).catch(() => undefined)),
    );
  }

  function runDailyIfDue(): void {
    enqueue(async () => {
      if (stopping || backedUpToday()) return;
      await attempt("daily", null);
    });
  }

  function afterShiftClose(userId: string): void {
    enqueue(async () => {
      await attempt("shift_close", userId);
    });
  }

  function backupNow(userId: string): Promise<BackupAttempt> {
    return enqueueForResult(() => attempt("manual", userId));
  }

  function backupBeforeRestore(userId: string | null): Promise<BackupAttempt> {
    return enqueueForResult(() => attempt("pre_restore", userId));
  }

  function start(): void {
    enqueue(sweepTempFiles);
    runDailyIfDue();
    timer = setInterval(runDailyIfDue, dailyCheckMs);
    timer.unref();
  }

  function stop(): Promise<void> {
    stopping ??= (async () => {
      if (timer) clearInterval(timer);
      const deadline = setTimeout(() => abort.abort(), quitWaitMs);
      try {
        await whenIdle();
      } finally {
        clearTimeout(deadline);
      }
    })();
    return stopping;
  }

  return { start, runDailyIfDue, afterShiftClose, backupNow, backupBeforeRestore, whenIdle, stop };
}

export type BackupService = ReturnType<typeof createBackupService>;
