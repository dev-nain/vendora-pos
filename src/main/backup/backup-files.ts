import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { backupFileNameSchema, type BackupFile, type BackupKind } from "../../shared/backup";
import { isEncryptedBackup } from "./backup-cipher";

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
