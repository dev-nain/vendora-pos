import { join } from "node:path";
import type { ChosenBackup, RestoreInput, RestoreResult } from "../../shared/backup";
import type { RecoveryBackup, RecoveryScan, StartupState } from "../../shared/recovery";
import { RecoveryUnavailableError } from "../auth/errors";
import { createRestoreSources, listBackupFiles } from "../backup/backup-files";
import { restoreMessages, type RecoveryRestore } from "../backup/restore";
import { checkBackup, type BackupCheck } from "../backup/restore-check";

interface RecoveryDeps {
  state: StartupState;
  backupDir: string;
  migrationsFolder: string;
  chooseFile: () => Promise<string | null>;
  restores: Pick<RecoveryRestore, "restore">;
  relaunch: () => void | Promise<void>;
}

const unreadable: BackupCheck = { ok: false, reason: "corrupt" };

export function createRecoveryService({
  state,
  backupDir,
  migrationsFolder,
  chooseFile,
  restores,
  relaunch,
}: RecoveryDeps) {
  const sources = createRestoreSources(backupDir);

  function requireMode(mode: StartupState["mode"]): void {
    if (state.mode !== mode) throw new RecoveryUnavailableError();
  }

  async function scan(): Promise<RecoveryScan> {
    requireMode("damaged");
    const backups: RecoveryBackup[] = [];
    let lastGood: string | null = null;
    for (const file of await listBackupFiles(backupDir)) {
      const entry = { fileName: file.fileName, kind: file.kind, takenAt: file.takenAt };
      if (file.encrypted) {
        backups.push({ ...entry, status: "password-protected" });
        lastGood = file.fileName;
        break;
      }
      const check = await checkBackup(join(backupDir, file.fileName), migrationsFolder).catch(
        () => unreadable,
      );
      if (check.ok) {
        backups.push({ ...entry, status: "good" });
        lastGood = file.fileName;
        break;
      }
      backups.push({ ...entry, status: check.reason });
    }
    return { backups, lastGood };
  }

  async function chooseBackupFile(): Promise<ChosenBackup> {
    requireMode("damaged");
    const file = await chooseFile();
    return file === null ? null : sources.register(file);
  }

  async function restore(input: RestoreInput): Promise<RestoreResult> {
    requireMode("damaged");
    const source = await sources.resolve(input);
    if (!source) return { ok: false, reason: "not-found", message: restoreMessages["not-found"] };
    const result = await restores.restore(source, input.password);
    sources.keepForRetry(input, source, result);
    return result;
  }

  async function retry(): Promise<void> {
    requireMode("open-failed");
    await relaunch();
  }

  return { state: () => state, scan, chooseFile: chooseBackupFile, restore, retry };
}

export type RecoveryService = ReturnType<typeof createRecoveryService>;
