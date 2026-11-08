import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startBackgroundCheckpoints } from "./checkpointer";
import { openDatabase, type VendoraDatabase } from "./client";

const workerFile = resolve(process.cwd(), "src/main/db/checkpoint-worker.ts");

describe("startBackgroundCheckpoints", () => {
  let dir: string;
  let database: VendoraDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-checkpoint-"));
    database = openDatabase(join(dir, "vendora.db"));
    database.sqlite.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const fill = () => {
    const insert = database.sqlite.prepare("INSERT INTO t (v) VALUES (?)");
    database.sqlite.transaction(() => {
      for (let i = 0; i < 5000; i++) insert.run("x".repeat(200));
    })();
  };
  const walPages = () =>
    (
      database.sqlite.pragma("wal_checkpoint(PASSIVE)") as { log: number; checkpointed: number }[]
    )[0]!;

  it("stops checkpointing on commit while it runs", async () => {
    const checkpoints = startBackgroundCheckpoints(database, workerFile, 60_000);
    try {
      expect(database.sqlite.pragma("wal_autocheckpoint", { simple: true })).toBe(0);
      fill();
      expect(statSync(join(dir, "vendora.db")).size).toBeLessThan(100_000);
    } finally {
      await checkpoints.stop();
    }
    expect(database.sqlite.pragma("wal_autocheckpoint", { simple: true })).toBe(1000);
  });

  it("checkpoints the WAL from the worker", async () => {
    const checkpoints = startBackgroundCheckpoints(database, workerFile, 20);
    fill();
    await new Promise((done) => setTimeout(done, 500));
    await checkpoints.stop();
    const { log, checkpointed } = walPages();
    expect(log).toBeGreaterThan(0);
    expect(checkpointed).toBe(log);
    expect(statSync(join(dir, "vendora.db")).size).toBeGreaterThan(1_000_000);
  });

  it("keeps every committed row", async () => {
    const checkpoints = startBackgroundCheckpoints(database, workerFile, 10);
    fill();
    fill();
    await checkpoints.stop();
    expect(database.sqlite.prepare("SELECT count(*) AS n FROM t").get()).toEqual({ n: 10_000 });
  });

  it("stops once even when asked twice", async () => {
    const checkpoints = startBackgroundCheckpoints(database, workerFile);
    await Promise.all([checkpoints.stop(), checkpoints.stop()]);
  });
});
