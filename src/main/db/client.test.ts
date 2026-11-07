import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type VendoraDatabase } from "./client";

describe("openDatabase", () => {
  let dir: string;
  let database: VendoraDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-client-"));
    database = openDatabase(join(dir, "vendora.db"));
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("uses WAL journaling", () => {
    expect(database.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
  });

  it("syncs fully on every commit", () => {
    const FULL = 2;
    expect(database.sqlite.pragma("synchronous", { simple: true })).toBe(FULL);
  });

  it("enforces foreign keys", () => {
    expect(database.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("waits for locks", () => {
    expect(database.sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
  });

  it("keeps a committed write after the process is killed, because WAL with synchronous FULL syncs before commit returns", () => {
    const file = join(dir, "killed.db");
    const script = `
      const Database = require("better-sqlite3");
      const sqlite = new Database(process.argv[1]);
      sqlite.pragma("journal_mode = WAL");
      sqlite.pragma("synchronous = FULL");
      sqlite.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
      sqlite.prepare("INSERT INTO t (v) VALUES (?)").run("committed");
      process.kill(process.pid, "SIGKILL");
    `;
    const child = spawnSync(process.execPath, ["-e", script, file], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      cwd: process.cwd(),
    });
    // Windows has no signals: a self-kill is TerminateProcess with exit code 1.
    if (process.platform === "win32") expect(child.status).toBe(1);
    else expect(child.signal).toBe("SIGKILL");

    const reopened = openDatabase(file);
    try {
      expect(reopened.sqlite.prepare("SELECT v FROM t").all()).toEqual([{ v: "committed" }]);
    } finally {
      reopened.sqlite.close();
    }
  });
});
