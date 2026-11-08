import { copyFile, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import type { RestoreRefusal, RestoreResult } from "../../shared/backup";
import { openDatabase, type VendoraDatabase } from "../db/client";
import { runMigrations } from "../db/migrate";
import { backupStamp } from "../db/vacuum-into";
import { users } from "../db/schema";
import { createAuditService } from "../services/audit";
import type { BackupAttempt } from "./backup-service";
import { isEncryptedBackup, openBackupFile, readBackupHeader } from "./backup-cipher";
import { deriveBackupKey } from "./backup-key";
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
  "set-aside-failed": "Couldn't move the damaged data file. Nothing was restored. Try again.",
  "password-required": "This backup has a password. Enter it to restore. Nothing was changed.",
  "wrong-password":
    "That password doesn't open this backup, or the file is damaged. Nothing was changed.",
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

interface StageDeps {
  databaseFile: string;
  backupDir: string;
  migrationsFolder: string;
}

async function stage(
  { databaseFile, migrationsFolder }: StageDeps,
  source: RestoreSource,
  password: string | undefined,
): Promise<RestoreResult | null> {
  const staged = stagedFile(databaseFile);
  await removeStagedRestore(databaseFile);
  try {
    if (!(await isEncryptedBackup(source.file))) {
      await copyFile(source.file, staged);
    } else {
      if (password === undefined) return refuse("password-required");
      const header = await readBackupHeader(source.file);
      if (!header.ok) return refuse(header.reason);
      const key = await deriveBackupKey(password, header.header.passwordSalt, header.header.kdf);
      if (!(await openBackupFile(source.file, staged, header.header, key))) {
        return refuse("wrong-password");
      }
    }
  } catch (cause) {
    logFailure("Restore copy failed:", cause);
    return refuse("not-found");
  }
  const check = await checkBackup(staged, migrationsFolder);
  return check.ok ? null : refuse(check.reason);
}

async function prepareRestore(
  deps: StageDeps,
  source: RestoreSource,
  password: string | undefined,
  finish: (staged: VendoraDatabase) => Promise<RestoreResult | null>,
): Promise<RestoreResult | null> {
  const staged = stagedFile(deps.databaseFile);
  const refused = await stage(deps, source, password);
  if (refused) return refused;

  let stagedDatabase: VendoraDatabase | null = null;
  try {
    try {
      stagedDatabase = openDatabase(staged);
      runMigrations(stagedDatabase, {
        migrationsFolder: deps.migrationsFolder,
        backupDir: deps.backupDir,
      });
    } catch (cause) {
      logFailure("Restore migration failed:", cause);
      return refuse("migration-failed");
    }
    const unfinished = await finish(stagedDatabase);
    if (unfinished) return unfinished;
    stagedDatabase.sqlite.pragma("wal_checkpoint(TRUNCATE)");
    stagedDatabase.sqlite.close();
    stagedDatabase = null;
    // The rename must not publish a file a power cut could lose.
    await syncFile(staged);
    return null;
  } finally {
    if (stagedDatabase?.sqlite.open) stagedDatabase.sqlite.close();
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
    password?: string,
  ): Promise<RestoreResult> {
    try {
      const refused = await prepareRestore(
        { databaseFile, backupDir, migrationsFolder },
        source,
        password,
        async (stagedDatabase) => {
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
          return null;
        },
      );
      if (refused) return refused;
      return await swap();
    } finally {
      await removeStagedRestore(databaseFile);
    }
  }

  return { restore };
}

export type RestoreService = ReturnType<typeof createRestoreService>;

interface RecoveryRestoreDeps extends StageDeps {
  restart: (failure: string | null) => void | Promise<void>;
  now?: () => Date;
  renameFile?: (from: string, to: string) => Promise<void>;
}

const databaseSuffixes = ["", "-wal", "-shm"];

function setAsideMessage(cause: unknown): string {
  const code = typeof cause === "object" && cause !== null && "code" in cause ? cause.code : "";
  if (code === "EBUSY" || code === "EPERM") {
    return "Couldn't move the damaged data file because another program is using it. Nothing was restored. Close other programs and try again.";
  }
  if (code === "EACCES") {
    return "Windows didn't let Vendora move the damaged data file. Nothing was restored. Try again, or restart the PC first.";
  }
  return restoreMessages["set-aside-failed"];
}

async function moveBack(moved: [string, string][]): Promise<void> {
  for (const [from, to] of moved.toReversed()) {
    try {
      await rename(to, from);
    } catch (cause) {
      logFailure("Moving the damaged file back failed:", cause);
    }
  }
}

export function createRecoveryRestore({
  databaseFile,
  backupDir,
  migrationsFolder,
  restart,
  now = () => new Date(),
  renameFile = rename,
}: RecoveryRestoreDeps) {
  const staged = stagedFile(databaseFile);

  async function moveAll(
    pairs: [from: string, to: string][],
  ): Promise<{ moved: [string, string][]; failure: unknown }> {
    const moved: [string, string][] = [];
    for (const [from, to] of pairs) {
      try {
        await renameFile(from, to);
        moved.push([from, to]);
      } catch (cause) {
        if (
          typeof cause === "object" &&
          cause !== null &&
          "code" in cause &&
          cause.code === "ENOENT"
        ) {
          continue;
        }
        return { moved, failure: cause };
      }
    }
    return { moved, failure: null };
  }

  async function restore(source: RestoreSource, password?: string): Promise<RestoreResult> {
    try {
      const damaged = join(dirname(databaseFile), `vendora-damaged-${backupStamp(now())}.db`);
      const refused = await prepareRestore(
        { databaseFile, backupDir, migrationsFolder },
        source,
        password,
        async (stagedDatabase) => {
          createAuditService(stagedDatabase).record({
            action: "restore",
            actorUserId: null,
            entityType: "backup",
            details: {
              fileName: source.fileName,
              takenAt: source.takenAt,
              damagedFile: basename(damaged),
              recovery: true,
            },
          });
          return null;
        },
      );
      if (refused) return refused;

      const aside = await moveAll(
        databaseSuffixes.map((suffix) => [`${databaseFile}${suffix}`, `${damaged}${suffix}`]),
      );
      if (aside.failure) {
        logFailure("Setting the damaged file aside failed:", aside.failure);
        await moveBack(aside.moved);
        return {
          ok: false,
          reason: "set-aside-failed",
          message: setAsideMessage(aside.failure),
        };
      }
      try {
        await renameFile(staged, databaseFile);
      } catch (cause) {
        logFailure("Restore swap failed:", cause);
        await moveBack(aside.moved);
        return {
          ok: false,
          reason: "swap-failed",
          message: "The restore didn't finish. Nothing was changed. Try again.",
        };
      }
      await restart(null);
      return { ok: true };
    } finally {
      await removeStagedRestore(databaseFile);
    }
  }

  return { restore };
}

export type RecoveryRestore = ReturnType<typeof createRecoveryRestore>;
