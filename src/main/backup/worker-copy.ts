import { Worker } from "node:worker_threads";
import type { BackupSeal } from "./backup-cipher";

export interface CopyJob {
  sourceFile: string;
  tempFile: string;
  seal: BackupSeal | null;
  signal: AbortSignal;
}

export type CopyDatabase = (job: CopyJob) => Promise<{ sizeBytes: number }>;

export function createWorkerCopy(workerFile: string): CopyDatabase {
  return ({ sourceFile, tempFile, seal, signal }) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error("Backup was cancelled"));
        return;
      }
      const worker = new Worker(workerFile, { workerData: { sourceFile, tempFile, seal } });
      let settled = false;
      const settle = (finish: () => void) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        finish();
      };
      const onAbort = () => {
        settle(() => reject(new Error("Backup was cancelled")));
        void worker.terminate();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      worker.once("message", (message: { sizeBytes: number }) =>
        settle(() => resolve({ sizeBytes: message.sizeBytes })),
      );
      worker.once("error", (error) => settle(() => reject(error)));
      worker.once("exit", (code) =>
        settle(() => reject(new Error(`Backup worker exited with code ${code}`))),
      );
    });
}
