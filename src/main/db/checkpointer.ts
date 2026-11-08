import { Worker } from "node:worker_threads";
import type { VendoraDatabase } from "./client";

export interface BackgroundCheckpoints {
  stop: () => Promise<void>;
}

// A checkpoint copies every WAL page into the database file and syncs it; run inline at commit,
// it stalls the main process for seconds on slow Windows disks. A worker connection does it instead.
export function startBackgroundCheckpoints(
  database: VendoraDatabase,
  workerFile: string,
  intervalMs = 1000,
): BackgroundCheckpoints {
  database.sqlite.pragma("wal_autocheckpoint = 0");
  const worker = new Worker(workerFile, {
    workerData: { databaseFile: database.sqlite.name, intervalMs },
  });
  worker.on("error", (error: unknown) => {
    console.error("checkpoint worker failed", error instanceof Error ? error.message : "");
  });
  let stopping: Promise<void> | null = null;
  return {
    stop: () => {
      stopping ??= new Promise<void>((resolve) => {
        worker.once("exit", () => resolve());
        worker.once("message", () => void worker.terminate());
        worker.postMessage("stop", []);
      }).finally(() => {
        database.sqlite.pragma("wal_autocheckpoint = 1000");
      });
      return stopping;
    },
  };
}
