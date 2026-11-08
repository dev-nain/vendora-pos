import { randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  backupFileNameSchema,
  type BackupFile,
  type BackupKind,
  type ChosenBackup,
  type RestoreInput,
  type RestoreResult,
} from "../../shared/backup";
import { isEncryptedBackup } from "./backup-cipher";
import type { RestoreSource } from "./restore";

const kindByPrefix: Record<string, BackupKind> = {
  vendora: "backup",
  "pre-restore": "before-restore",
  "pre-migrate": "before-update",
};

export function parseBackupName(fileName: string): { kind: BackupKind; takenAt: string } | null {
  if (!backupFileNameSchema.safeParse(fileName).success) return null;
  const match = /^(.+?)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.db$/.exec(fileName);
  const [, prefix, date, hh, mm, ss, ms] = match ?? [];
  const kind = prefix ? kindByPrefix[prefix] : undefined;
  if (!kind) return null;
  const iso = `${date}T${hh}:${mm}:${ss}.${ms}Z`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== iso) return null;
  return { kind, takenAt: iso };
}

export async function listBackupFiles(backupDir: string): Promise<BackupFile[]> {
  const names = await readdir(backupDir).catch(() => []);
  const found = await Promise.all(
    names.map(async (fileName): Promise<BackupFile | null> => {
      const parsed = parseBackupName(fileName);
      if (!parsed) return null;
      const info = await stat(join(backupDir, fileName)).catch(() => null);
      if (!info?.isFile()) return null;
      const file = join(backupDir, fileName);
      const encrypted = await isEncryptedBackup(file).catch(() => null);
      if (encrypted === null) return null;
      return {
        fileName,
        kind: parsed.kind,
        takenAt: parsed.takenAt,
        sizeBytes: info.size,
        encrypted,
      };
    }),
  );
  return found
    .filter((file): file is BackupFile => file !== null)
    .toSorted((a, b) => b.takenAt.localeCompare(a.takenAt));
}

export async function describePickedFile(
  file: string,
): Promise<{ fileName: string; takenAt: string; encrypted: boolean }> {
  const fileName = basename(file);
  const takenAt = parseBackupName(fileName)?.takenAt ?? (await stat(file)).mtime.toISOString();
  return { fileName, takenAt, encrypted: await isEncryptedBackup(file) };
}

export function createRestoreSources(backupDir: string) {
  let chosen: { token: string; source: RestoreSource } | null = null;

  async function register(file: string): Promise<NonNullable<ChosenBackup>> {
    const described = await describePickedFile(file);
    const token = randomUUID();
    chosen = {
      token,
      source: { file, fileName: described.fileName, takenAt: described.takenAt },
    };
    return { token, ...described };
  }

  async function resolve(input: RestoreInput): Promise<RestoreSource | null> {
    if (input.kind === "picked") {
      const slot = chosen;
      chosen = null;
      return slot && slot.token === input.token ? slot.source : null;
    }
    const fileName = basename(input.fileName);
    const listed = (await listBackupFiles(backupDir)).find((file) => file.fileName === fileName);
    return listed ? { file: join(backupDir, fileName), fileName, takenAt: listed.takenAt } : null;
  }

  function keepForRetry(input: RestoreInput, source: RestoreSource, result: RestoreResult): void {
    if (
      input.kind === "picked" &&
      !result.ok &&
      (result.reason === "password-required" || result.reason === "wrong-password")
    ) {
      chosen = { token: input.token, source };
    }
  }

  return { register, resolve, keepForRetry };
}
