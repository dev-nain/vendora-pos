import { copyFile, open, rename, rm } from "node:fs/promises";
import { eq } from "drizzle-orm";
import type { RestoreRefusal, RestoreResult } from "../../shared/backup";
import { openDatabase, type VendoraDatabase } from "../db/client";
import { runMigrations } from "../db/migrate";
import { users } from "../db/schema";
import { createAuditService } from "../services/audit";
import type { BackupAttempt } from "./backup-service";
import { checkBackup } from "./restore-check";

export interface RestoreActor {
  userId: string;
  displayName: string;
}

export interface RestoreSource {
  file: string;
  fileName: string;
  takenAt: string;
}

interface RestoreDeps {
  databaseFile: string;
  backupDir: string;
  migrationsFolder: string;
  backupCurrent: (userId: string | null) => Promise<BackupAttempt>;
  closeDatabase: () => Promise<void>;
  restart: (failure: string | null) => void | Promise<void>;
  replaceFile?: (from: string, to: string) => Promise<void>;
}

export const restoreMessages: Record<Exclude<RestoreRefusal, "open-work">, string> = {
  "not-found": "That backup is no longer there. Nothing was changed.",
  "not-vendora": "This file isn't a Vendora backup. Nothing was changed.",
  corrupt: "This backup is damaged and can't be restored. Nothing was changed.",
  "newer-version":
    "This backup is from a newer version of Vendora. Update the app and try again. Nothing was changed.",
  "migration-failed": "This backup couldn't be brought up to date. Nothing was changed.",
  "backup-failed": "Couldn't back up the current data, so nothing was restored.",
  "swap-failed": "The restore didn't finish. Your data is unchanged. Vendora will restart.",
};

const stagedSuffixes = ["", "-wal", "-shm"];

function stagedFile(databaseFile: string): string {
  return `${databaseFile}.restore`;
}

export async function removeStagedRestore(databaseFile: string): Promise<void> {
  await Promise.all(
    stagedSuffixes.map((suffix) => rm(`${stagedFile(databaseFile)}${suffix}`, { force: true })),
  );
}

function refuse(reason: Exclude<RestoreRefusal, "open-work">): RestoreResult {
  return { ok: false, reason, message: restoreMessages[reason] };
}

function logFailure(label: string, cause: unknown): void {
  console.error(label, cause instanceof Error ? cause.message : String(cause));
}

async function syncFile(file: string): Promise<void> {
  const handle = await open(file, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function createRestoreService({
  databaseFile,
  backupDir,
  migrationsFolder,
  backupCurrent,
  closeDatabase,
  restart,
  replaceFile = rename,
}: RestoreDeps) {
  const staged = stagedFile(databaseFile);

  async function stage(source: RestoreSource): Promise<RestoreResult | null> {
    await removeStagedRestore(databaseFile);
    try {
      await copyFile(source.file, staged);
    } catch (cause) {
      logFailure("Restore copy failed:", cause);
      return refuse("not-found");
    }
    const check = await checkBackup(staged, migrationsFolder);
    return check.ok ? null : refuse(check.reason);
  }

  async function swap(): Promise<RestoreResult> {
    try {
      await closeDatabase();
      // A leftover -wal would be replayed into the new file.
      await Promise.all(
        ["-wal", "-shm"].map((suffix) => rm(`${databaseFile}${suffix}`, { force: true })),
      );
      await replaceFile(staged, databaseFile);
    } catch (cause) {
      logFailure("Restore swap failed:", cause);
      await restart(restoreMessages["swap-failed"]);
      return refuse("swap-failed");
    }
    await restart(null);
    return { ok: true };
  }

  async function restore(
    source: RestoreSource,
    actor: RestoreActor | null,
  ): Promise<RestoreResult> {
    let stagedDatabase: VendoraDatabase | null = null;
    try {
      const refused = await stage(source);
      if (refused) return refused;

      try {
        stagedDatabase = openDatabase(staged);
        runMigrations(stagedDatabase, { migrationsFolder, backupDir });
      } catch (cause) {
        logFailure("Restore migration failed:", cause);
        return refuse("migration-failed");
      }

      let preRestoreFile: string;
      try {
        const backup = await backupCurrent(actor?.userId ?? null);
        if (!backup.ok) {
          logFailure("Pre-restore backup failed:", backup.error);
          return refuse("backup-failed");
        }
        preRestoreFile = backup.fileName;
      } catch (cause) {
        logFailure("Pre-restore backup failed:", cause);
        return refuse("backup-failed");
      }

      const linkedUserId =
        actor &&
        stagedDatabase.db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, actor.userId))
          .get()
          ? actor.userId
          : null;
      createAuditService(stagedDatabase).record({
        action: "restore",
        actorUserId: linkedUserId,
        entityType: "backup",
        details: {
          fileName: source.fileName,
          takenAt: source.takenAt,
          preRestoreFile,
          ...(actor && !linkedUserId ? { actorName: actor.displayName } : {}),
        },
      });
      stagedDatabase.sqlite.pragma("wal_checkpoint(TRUNCATE)");
      stagedDatabase.sqlite.close();
      stagedDatabase = null;
      // The rename must not publish a file a power cut could lose.
      await syncFile(staged);

      return await swap();
    } finally {
      if (stagedDatabase?.sqlite.open) stagedDatabase.sqlite.close();
      await removeStagedRestore(databaseFile);
    }
  }

  return { restore };
}

export type RestoreService = ReturnType<typeof createRestoreService>;
