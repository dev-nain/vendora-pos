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
});
