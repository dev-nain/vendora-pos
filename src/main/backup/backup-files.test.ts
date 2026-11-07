import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sealBackupFile } from "./backup-cipher";
import { listBackupFiles, parseBackupName } from "./backup-files";

describe("parseBackupName", () => {
  it("parses all three kinds", () => {
    expect(parseBackupName("vendora-2026-11-06T12-30-00-123Z.db")).toEqual({
      kind: "backup",
      takenAt: "2026-11-06T12:30:00.123Z",
    });
    expect(parseBackupName("pre-restore-2026-11-06T12-30-00-123Z.db")?.kind).toBe("before-restore");
    expect(parseBackupName("pre-migrate-2026-11-06T12-30-00-123Z.db")?.kind).toBe("before-update");
  });

  it("rejects wrong names, impossible dates and temp files", () => {
    expect(parseBackupName("vendora.db")).toBeNull();
    expect(parseBackupName("other-2026-11-06T12-30-00-123Z.db")).toBeNull();
    expect(parseBackupName("vendora-2026-13-40T12-30-00-123Z.db")).toBeNull();
    expect(parseBackupName("vendora-2026-02-30T12-30-00-123Z.db")).toBeNull();
    expect(parseBackupName("vendora-2026-11-06T12-30-00-123Z.db.tmp")).toBeNull();
  });
});

describe("listBackupFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-backup-files-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists parsed backups newest first with sizes", async () => {
    writeFileSync(join(dir, "vendora-2026-11-05T01-00-00-000Z.db"), "abc");
    writeFileSync(join(dir, "pre-restore-2026-11-06T01-00-00-000Z.db"), "abcdef");
    writeFileSync(join(dir, "vendora-2026-11-07T01-00-00-000Z.db.tmp"), "x");
    writeFileSync(join(dir, "notes.txt"), "x");
    mkdirSync(join(dir, "vendora-2026-11-08T01-00-00-000Z.db"));

    expect(await listBackupFiles(dir)).toEqual([
      {
        fileName: "pre-restore-2026-11-06T01-00-00-000Z.db",
        kind: "before-restore",
        takenAt: "2026-11-06T01:00:00.000Z",
        sizeBytes: 6,
        encrypted: false,
      },
      {
        fileName: "vendora-2026-11-05T01-00-00-000Z.db",
        kind: "backup",
        takenAt: "2026-11-05T01:00:00.000Z",
        sizeBytes: 3,
        encrypted: false,
      },
    ]);
  });

  it("marks a sealed file as encrypted and a plain one as not", async () => {
    const plain = join(dir, "plain.tmp");
    writeFileSync(
      plain,
      Buffer.concat([Buffer.from("SQLite format 3\0", "latin1"), randomBytes(64)]),
    );
    sealBackupFile(plain, join(dir, "vendora-2026-11-05T01-00-00-000Z.db"), {
      key: randomBytes(32),
      salt: randomBytes(16),
      kdf: { memoryKiB: 64, iterations: 1, parallelism: 1 },
    });
    writeFileSync(join(dir, "vendora-2026-11-06T01-00-00-000Z.db"), "SQLite format 3\0 rest");

    expect((await listBackupFiles(dir)).map((file) => file.encrypted)).toEqual([false, true]);
  });

  it("returns an empty list for a missing folder", async () => {
    expect(await listBackupFiles(join(dir, "missing"))).toEqual([]);
  });
});
