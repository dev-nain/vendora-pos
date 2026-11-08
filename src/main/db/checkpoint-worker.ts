import { parentPort, workerData } from "node:worker_threads";
import Database from "better-sqlite3";

const { databaseFile, intervalMs } = workerData as { databaseFile: string; intervalMs: number };

const sqlite = new Database(databaseFile, { fileMustExist: true });

function checkpoint() {
  try {
    sqlite.pragma("wal_checkpoint(PASSIVE)");
  } catch (error) {
    console.error("background checkpoint failed", error instanceof Error ? error.message : "");
  }
}

const timer = setInterval(checkpoint, intervalMs);

parentPort?.on("message", (message: "stop") => {
  if (message !== "stop") return;
  clearInterval(timer);
  checkpoint();
  sqlite.close();
  parentPort?.postMessage("stopped", []);
  parentPort?.close();
});
