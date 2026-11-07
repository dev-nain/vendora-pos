import { createReadStream, createWriteStream } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

const maxReasonLength = 500;

export interface CopyFileJob {
  sourceFile: string;
  tempFile: string;
  signal: AbortSignal;
}

export type CopyFile = (job: CopyFileJob) => Promise<void>;

export const streamFile: CopyFile = async ({ sourceFile, tempFile, signal }) => {
  await pipeline(createReadStream(sourceFile), createWriteStream(tempFile), { signal });
  // The rename must not publish a file a power cut could lose.
  const handle = await open(tempFile, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

export async function writeSecondCopy(
  job: { sourceFile: string; folder: string; fileName: string; signal: AbortSignal },
  copyFile: CopyFile,
): Promise<void> {
  const tempFile = join(job.folder, `${job.fileName}.tmp`);
  try {
    await copyFile({ sourceFile: job.sourceFile, tempFile, signal: job.signal });
    await rename(tempFile, join(job.folder, job.fileName));
  } catch (cause) {
    await rm(tempFile, { force: true }).catch(() => undefined);
    throw cause;
  }
}

export function secondCopyReason(cause: unknown): string {
  const code = (cause as { code?: unknown } | null)?.code;
  const name = (cause as { name?: unknown } | null)?.name;
  let reason: string;
  if (code === "ENOENT" || code === "ENOTDIR" || code === "ENODEV") {
    reason = "Folder not found. If it's on a USB drive, plug it in.";
  } else if (code === "ENOSPC" || code === "EDQUOT") {
    reason = "Not enough free space in the folder.";
  } else if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    reason = "Vendora can't write to this folder.";
  } else if (name === "AbortError" || code === "ABORT_ERR") {
    reason = "Vendora closed before the copy finished.";
  } else {
    reason = (cause instanceof Error ? cause.message : String(cause)) || "Copy failed.";
  }
  return reason.slice(0, maxReasonLength);
}
