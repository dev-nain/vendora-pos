import { closeSync, fsyncSync, openSync, renameSync, rmSync, statSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import Database from "better-sqlite3";
// Tests load this file unbundled through Node type stripping, which needs the extension.
import { vacuumInto } from "../db/vacuum-into.ts";
import { sealBackupFile, sealedTempFile, type BackupSeal } from "./backup-cipher.ts";

interface CopyJob {
  sourceFile: string;
  tempFile: string;
  seal: BackupSeal | null;
}

const { sourceFile, tempFile, seal } = workerData as CopyJob;

const source = new Database(sourceFile, { readonly: true, fileMustExist: true });
try {
  vacuumInto(source, tempFile);
} finally {
  source.close();
}

const copy = new Database(tempFile, { readonly: true, fileMustExist: true });
try {
  const verdict = copy.pragma("integrity_check", { simple: true });
  if (verdict !== "ok") throw new Error(`Backup failed integrity_check: ${String(verdict)}`);
} finally {
  copy.close();
}

if (seal) {
  const sealedFile = sealedTempFile(tempFile);
  try {
    sealBackupFile(tempFile, sealedFile, seal);
    renameSync(sealedFile, tempFile);
  } catch (error) {
    rmSync(sealedFile, { force: true });
    throw error;
  }
}

// VACUUM INTO output is not synced, and the rename must not publish a file a power cut could lose.
const descriptor = openSync(tempFile, "r+");
try {
  fsyncSync(descriptor);
} finally {
  closeSync(descriptor);
}

parentPort?.postMessage({ sizeBytes: statSync(tempFile).size }, []);
