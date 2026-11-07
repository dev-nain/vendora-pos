import type { BackupKind } from "@shared/backup";

const kilobyte = 1024;
const megabyte = kilobyte * 1024;
const gigabyte = megabyte * 1024;

export function formatBackupSize(bytes: number): string {
  if (bytes < kilobyte) return `${bytes} B`;
  const kilobytes = Math.round(bytes / kilobyte);
  if (bytes < megabyte && kilobytes < kilobyte) return `${kilobytes} KB`;
  if (bytes < gigabyte) return `${(bytes / megabyte).toFixed(1)} MB`;
  return `${(bytes / gigabyte).toFixed(1)} GB`;
}

const kindLabels: Record<BackupKind, string> = {
  backup: "Backup",
  "before-restore": "Before restore",
  "before-update": "Before update",
};

export function backupKindLabel(kind: BackupKind): string {
  return kindLabels[kind];
}
