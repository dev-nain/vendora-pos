import { desc, eq } from "drizzle-orm";
import type {
  BackupNowResult,
  BackupStatus,
  ChosenBackup,
  RestoreInput,
  RestoreResult,
} from "../../shared/backup";
import type { ShiftState } from "../../shared/shifts";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import { createRestoreSources, listBackupFiles } from "../backup/backup-files";
import type { BackupService } from "../backup/backup-service";
import { restoreMessages, type RestoreService } from "../backup/restore";
import type { VendoraDatabase } from "../db/client";
import { backupRecords, users } from "../db/schema";
import type { ShiftsService } from "./shifts";

export function restoreBlocker(state: ShiftState): string | null {
  if (state.status === "closed") return null;
  const held = state.heldBills.length;
  if (held > 0) {
    return `Close the shift and clear ${held} ${held === 1 ? "bill" : "bills"} on hold before restoring.`;
  }
  return "Close the shift before restoring.";
}

interface BackupAdminDeps {
  database: VendoraDatabase;
  sessions: SessionStore;
  backups: Pick<BackupService, "backupNow">;
  restores: { restore: RestoreService["restore"] };
  shifts: Pick<ShiftsService, "state">;
  backupDir: string;
  chooseFile: () => Promise<string | null>;
}

export function createBackupAdminService({
  database,
  sessions,
  backups,
  restores,
  shifts,
  backupDir,
  chooseFile,
}: BackupAdminDeps) {
  const sources = createRestoreSources(backupDir);

  async function status(): Promise<BackupStatus> {
    requireSession(sessions);
    const backupFiles = await listBackupFiles(backupDir);
    const lastBackupAt = backupFiles[0]?.takenAt ?? null;
    const failure = database.db
      .select({ createdAt: backupRecords.createdAt, error: backupRecords.error })
      .from(backupRecords)
      .where(eq(backupRecords.result, "failed"))
      .orderBy(desc(backupRecords.createdAt))
      .limit(1)
      .get();
    const lastFailure =
      failure?.error && (lastBackupAt === null || failure.createdAt.toISOString() > lastBackupAt)
        ? { at: failure.createdAt.toISOString(), reason: failure.error }
        : null;
    return {
      lastBackupAt,
      lastFailure,
      backups: backupFiles,
      restoreBlock: restoreBlocker(shifts.state()),
    };
  }

  async function backupNow(): Promise<BackupNowResult> {
    const session = requireSession(sessions);
    const result = await backups.backupNow(session.userId);
    return result.ok ? { ok: true } : { ok: false, message: `Backup failed: ${result.error}` };
  }

  async function chooseRestoreFile(): Promise<ChosenBackup> {
    requireSession(sessions);
    const file = await chooseFile();
    if (file === null) return null;
    requireSession(sessions);
    return sources.register(file);
  }

  async function restore(input: RestoreInput): Promise<RestoreResult> {
    const session = requireSession(sessions);
    const message = restoreBlocker(shifts.state());
    if (message !== null) return { ok: false, reason: "open-work", message };

    const source = await sources.resolve(input);
    if (!source) {
      return {
        ok: false,
        reason: "not-found",
        message: restoreMessages["not-found"],
      };
    }
    const user = database.db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, session.userId))
      .get();
    const result = await restores.restore(
      source,
      user ? { userId: session.userId, displayName: user.displayName } : null,
      input.password,
    );
    sources.keepForRetry(input, source, result);
    return result;
  }

  return { status, backupNow, chooseRestoreFile, restore };
}

export type BackupAdminService = ReturnType<typeof createBackupAdminService>;
