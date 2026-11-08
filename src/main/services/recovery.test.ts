import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RestoreResult } from "../../shared/backup";
import type { StartupState } from "../../shared/recovery";
import { RecoveryUnavailableError } from "../auth/errors";
import { sealBackupFile } from "../backup/backup-cipher";
import { seedStoreAndTerminal } from "../db/seed";
import { openMigratedDatabase } from "../db/test-database";
import { vacuumInto } from "../db/vacuum-into";
import { createRecoveryService } from "./recovery";

const migrationsFolder = join(process.cwd(), "drizzle");
const good = "vendora-2026-11-03T01-00-00-000Z.db";
const middle = "vendora-2026-11-04T01-00-00-000Z.db";
const newest = "vendora-2026-11-05T01-00-00-000Z.db";

describe("createRecoveryService", () => {
  let dir: string;
  let backupDir: string;
  let goodFile: string;
  let restore: ReturnType<typeof vi.fn<() => Promise<RestoreResult>>>;
  let relaunch: ReturnType<typeof vi.fn<() => void>>;
  let chooseFile: ReturnType<typeof vi.fn<() => Promise<string | null>>>;

  const service = (state: StartupState = { mode: "damaged" }) =>
    createRecoveryService({
      state,
      backupDir,
      migrationsFolder,
      chooseFile,
      restores: { restore },
      relaunch,
    });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-recovery-"));
    backupDir = join(dir, "backups");
    mkdirSync(backupDir);
    const database = openMigratedDatabase(join(dir, "source.db"));
    seedStoreAndTerminal(database);
    goodFile = join(dir, "good.db");
    vacuumInto(database.sqlite, goodFile);
    database.sqlite.close();
    restore = vi.fn(async (): Promise<RestoreResult> => ({ ok: true }));
    relaunch = vi.fn();
    chooseFile = vi.fn(async () => null);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists a damaged newest backup above the good one and picks the good one", async () => {
    copyFileSync(goodFile, join(backupDir, good));
    writeFileSync(join(backupDir, newest), "SQLite format 3\0 but nothing else");

    expect(await service().scan()).toEqual({
      backups: [
        {
          fileName: newest,
          kind: "backup",
          takenAt: "2026-11-05T01:00:00.000Z",
          status: "corrupt",
        },
        { fileName: good, kind: "backup", takenAt: "2026-11-03T01:00:00.000Z", status: "good" },
      ],
      lastGood: good,
    });
  });

  it("stops at a password-protected backup and does not read older ones", async () => {
    copyFileSync(goodFile, join(backupDir, good));
    sealBackupFile(goodFile, join(backupDir, middle), {
      key: randomBytes(32),
      salt: randomBytes(16),
      kdf: { memoryKiB: 64, iterations: 1, parallelism: 1 },
    });

    expect(await service().scan()).toEqual({
      backups: [
        {
          fileName: middle,
          kind: "backup",
          takenAt: "2026-11-04T01:00:00.000Z",
          status: "password-protected",
        },
      ],
      lastGood: middle,
    });
  });

  it("returns an empty list when there are no backups", async () => {
    expect(await service().scan()).toEqual({ backups: [], lastGood: null });
  });

  it("refuses every gated method outside the mode it belongs to", async () => {
    const input = { kind: "listed", fileName: good } as const;
    for (const state of [
      { mode: "normal" },
      { mode: "newer-version" },
      { mode: "migration-failed" },
    ] as const) {
      const locked = service(state);
      await expect(locked.scan()).rejects.toBeInstanceOf(RecoveryUnavailableError);
      await expect(locked.chooseFile()).rejects.toBeInstanceOf(RecoveryUnavailableError);
      await expect(locked.restore(input)).rejects.toBeInstanceOf(RecoveryUnavailableError);
      await expect(locked.retry()).rejects.toBeInstanceOf(RecoveryUnavailableError);
    }
    await expect(service({ mode: "open-failed", failure: "in-use" }).scan()).rejects.toBeInstanceOf(
      RecoveryUnavailableError,
    );
    expect(restore).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("retries only when the file could not be opened", async () => {
    await expect(service({ mode: "damaged" }).retry()).rejects.toBeInstanceOf(
      RecoveryUnavailableError,
    );
    await service({ mode: "open-failed", failure: "in-use" }).retry();
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("restores a listed backup and passes the password through", async () => {
    copyFileSync(goodFile, join(backupDir, good));

    const result = await service().restore({ kind: "listed", fileName: good, password: "pw" });

    expect(result).toEqual({ ok: true });
    expect(restore).toHaveBeenCalledWith(
      { file: join(backupDir, good), fileName: good, takenAt: "2026-11-03T01:00:00.000Z" },
      "pw",
    );
  });

  it("answers not-found for a listed name that is not in the folder", async () => {
    expect(await service().restore({ kind: "listed", fileName: good })).toMatchObject({
      ok: false,
      reason: "not-found",
    });
    expect(restore).not.toHaveBeenCalled();
  });

  it("uses a picked file once, and keeps it for a password retry", async () => {
    const usb = join(dir, "my-backup.db");
    copyFileSync(goodFile, usb);
    chooseFile.mockResolvedValue(usb);
    const recovery = service();
    const picked = await recovery.chooseFile();
    if (!picked) throw new Error("expected a picked file");
    const input = { kind: "picked", token: picked.token } as const;

    restore.mockResolvedValueOnce({ ok: false, reason: "wrong-password", message: "no" });
    expect(await recovery.restore(input)).toMatchObject({ reason: "wrong-password" });
    expect(await recovery.restore(input)).toEqual({ ok: true });
    expect(await recovery.restore(input)).toMatchObject({ ok: false, reason: "not-found" });
    expect(restore).toHaveBeenCalledTimes(2);
  });

  it("returns nothing when the picker is cancelled", async () => {
    expect(await service().chooseFile()).toBeNull();
  });
});
