import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../db/client";
import { lastAppliedAt, latestMigrationAt, runMigrations } from "../db/migrate";
import { vacuumInto } from "../db/vacuum-into";
import { createCheckoutKit, type CheckoutKit } from "../services/checkout-test-kit";
import { createBackupService } from "./backup-service";
import { createRestoreService, restoreMessages, type RestoreSource } from "./restore";
import type { CopyDatabase } from "./worker-copy";

const migrationsFolder = join(process.cwd(), "drizzle");

const vacuumCopy: CopyDatabase = async ({ sourceFile, tempFile }) => {
  const source = new Database(sourceFile, { readonly: true });
  try {
    vacuumInto(source, tempFile);
  } finally {
    source.close();
  }
  return { sizeBytes: statSync(tempFile).size };
};

function snapshot(file: string): Record<string, unknown[]> {
  const sqlite = new Database(file, { readonly: true });
  try {
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY name",
      )
      .all() as { name: string }[];
    return Object.fromEntries(
      tables.map(({ name }) => [
        name,
        sqlite.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
      ]),
    );
  } finally {
    sqlite.close();
  }
}

function restoreRows(file: string) {
  const sqlite = new Database(file, { readonly: true });
  try {
    return sqlite.prepare("SELECT * FROM audit_log WHERE action = 'restore'").all() as {
      actor_user_id: string | null;
      details: string;
    }[];
  } finally {
    sqlite.close();
  }
}

function sourceOf(file: string): RestoreSource {
  return { file, fileName: basename(file), takenAt: "2026-11-01T00:00:00.000Z" };
}

function scribble(file: string): void {
  const size = statSync(file).size;
  const fd = openSync(file, "r+");
  writeSync(fd, Buffer.alloc(65_536, 0xff), 0, 65_536, Math.floor(size / 8192 / 2) * 8192);
  closeSync(fd);
}

function productNames(file: string): string[] {
  const sqlite = new Database(file, { readonly: true });
  try {
    return (sqlite.prepare("SELECT name_en FROM products").all() as { name_en: string }[]).map(
      (row) => row.name_en,
    );
  } finally {
    sqlite.close();
  }
}

describe("createRestoreService", () => {
  let kit: CheckoutKit;
  let databaseFile: string;
  let backupDir: string;
  let closeDatabase: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let restart: ReturnType<typeof vi.fn<(failure: string | null) => void>>;
  let backups: ReturnType<typeof createBackupService>;
  let backupCurrent: ReturnType<typeof vi.fn<typeof backups.backupBeforeRestore>>;

  const createService = (overrides: Partial<Parameters<typeof createRestoreService>[0]> = {}) =>
    createRestoreService({
      databaseFile,
      backupDir,
      migrationsFolder,
      backupCurrent,
      closeDatabase,
      restart,
      ...overrides,
    });

  const takeBackup = (name = "vendora-2026-11-01T00-00-00-000Z.db") => {
    mkdirSync(backupDir, { recursive: true });
    const file = join(backupDir, name);
    const source = new Database(databaseFile, { readonly: true });
    try {
      vacuumInto(source, file);
    } finally {
      source.close();
    }
    return file;
  };

  const stagedLeftovers = () => readdirSync(kit.dir).filter((name) => name.includes(".restore"));
  const expectRefusedUntouched = async (file: string, reason: string) => {
    const before = readFileSync(databaseFile);

    const result = await createService().restore(sourceOf(file), null);

    expect(result).toMatchObject({ ok: false, reason });
    expect(readFileSync(databaseFile).equals(before)).toBe(true);
    expect(closeDatabase).not.toHaveBeenCalled();
    expect(backupCurrent).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
    expect(stagedLeftovers()).toEqual([]);
  };

  beforeEach(() => {
    kit = createCheckoutKit();
    databaseFile = join(kit.dir, "vendora.db");
    backupDir = join(kit.dir, "backups");
    backups = createBackupService({
      database: kit.database,
      audit: kit.audit,
      backupDir,
      copy: vacuumCopy,
      seal: async () => null,
    });
    backupCurrent = vi.fn(backups.backupBeforeRestore);
    closeDatabase = vi.fn(async () => {
      kit.database.sqlite.close();
    });
    restart = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    kit.close();
  });

  describe("refusals", () => {
    it("rejects a corrupt file and changes nothing", async () => {
      const bad = takeBackup();
      scribble(bad);

      await expectRefusedUntouched(bad, "corrupt");
    });

    it("rejects a file that is not a Vendora database", async () => {
      const note = join(kit.dir, "note.db");
      writeFileSync(note, "plain text");

      await expectRefusedUntouched(note, "not-vendora");
    });

    it("rejects a backup from a newer version", async () => {
      const newer = takeBackup();
      const database = openDatabase(newer);
      database.sqlite.exec(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('future', 9999999999999)",
      );
      database.sqlite.close();

      await expectRefusedUntouched(newer, "newer-version");
    });

    it("rejects a missing file", async () => {
      await expectRefusedUntouched(join(backupDir, "gone.db"), "not-found");
    });

    it("returns migration-failed with the current data intact", async () => {
      const file = takeBackup();
      const folder = join(kit.dir, "bad-migrations");
      cpSync(migrationsFolder, folder, { recursive: true });
      const journalFile = join(folder, "meta", "_journal.json");
      const journal = JSON.parse(readFileSync(journalFile, "utf8")) as {
        entries: {
          idx: number;
          version: string;
          when: number;
          tag: string;
          breakpoints: boolean;
        }[];
      };
      journal.entries.push({
        idx: journal.entries.length,
        version: "6",
        when: (latestMigrationAt(folder) ?? 0) + 1000,
        tag: "9999_bad",
        breakpoints: true,
      });
      writeFileSync(journalFile, JSON.stringify(journal));
      writeFileSync(join(folder, "9999_bad.sql"), "THIS IS NOT SQL;");
      const before = snapshot(databaseFile);

      const result = await createService({ migrationsFolder: folder }).restore(
        sourceOf(file),
        null,
      );

      expect(result).toMatchObject({ ok: false, reason: "migration-failed" });
      expect(closeDatabase).not.toHaveBeenCalled();
      expect(backupCurrent).not.toHaveBeenCalled();
      expect(snapshot(databaseFile)).toEqual(before);
      expect(stagedLeftovers()).toEqual([]);
    });
  });

  describe("failures", () => {
    it("keeps the current data when the swap fails", async () => {
      const file = takeBackup();
      kit.addProduct({ nameEn: "Newer than the backup" });
      const before = snapshot(databaseFile);
      const replaceFile = vi.fn(async () => {
        throw new Error("rename blocked");
      });

      const result = await createService({ replaceFile }).restore(sourceOf(file), null);

      expect(result).toMatchObject({ ok: false, reason: "swap-failed" });
      expect(restart).toHaveBeenCalledWith(restoreMessages["swap-failed"]);
      expect(snapshot(databaseFile)).toEqual({
        ...before,
        backup_records: expect.any(Array),
        audit_log: expect.any(Array),
      });
      expect(productNames(databaseFile)).toContain("Newer than the backup");
      expect(stagedLeftovers()).toEqual([]);
    });

    it("keeps the current data when closing the database fails", async () => {
      const file = takeBackup();
      kit.addProduct({ nameEn: "Newer than the backup" });
      closeDatabase.mockRejectedValueOnce(new Error("busy"));

      const result = await createService().restore(sourceOf(file), null);

      expect(result).toMatchObject({ ok: false, reason: "swap-failed" });
      expect(restart).toHaveBeenCalledWith(restoreMessages["swap-failed"]);
      expect(productNames(databaseFile)).toContain("Newer than the backup");
      expect(stagedLeftovers()).toEqual([]);
    });

    it("refuses with backup-failed and never closes the database when the pre-restore backup fails", async () => {
      const file = takeBackup();
      backupCurrent.mockResolvedValueOnce({ ok: false, error: "disk full" });

      const result = await createService().restore(sourceOf(file), null);

      expect(result).toMatchObject({ ok: false, reason: "backup-failed" });
      expect(closeDatabase).not.toHaveBeenCalled();
      expect(restart).not.toHaveBeenCalled();
      expect(stagedLeftovers()).toEqual([]);
    });

    it("treats a throwing pre-restore backup as backup-failed", async () => {
      const file = takeBackup();
      backupCurrent.mockRejectedValueOnce(new Error("queue broke"));

      const result = await createService().restore(sourceOf(file), null);

      expect(result).toMatchObject({ ok: false, reason: "backup-failed" });
      expect(closeDatabase).not.toHaveBeenCalled();
    });
  });

  describe("a good restore", () => {
    it("writes a pre-restore backup holding the old data, then swaps and restarts", async () => {
      const file = takeBackup();
      kit.addProduct({ nameEn: "Newer than the backup" });

      const result = await createService().restore(sourceOf(file), null);

      expect(result).toEqual({ ok: true });
      expect(restart).toHaveBeenCalledWith(null);
      expect(existsSync(`${databaseFile}-wal`)).toBe(false);
      const preRestore = readdirSync(backupDir).filter((name) => name.startsWith("pre-restore-"));
      expect(preRestore).toHaveLength(1);
      expect(productNames(join(backupDir, preRestore[0]!))).toContain("Newer than the backup");
      expect(productNames(databaseFile)).not.toContain("Newer than the backup");
      expect(stagedLeftovers()).toEqual([]);
    });

    it("restores every table and adds only the restore row", async () => {
      const user = kit.signIn("cashier");
      kit.addProduct({ nameEn: "In the backup" });
      const file = takeBackup();
      const expected = snapshot(file);
      kit.addProduct({ nameEn: "Added later" });
      kit.audit.record({ action: "login", actorUserId: user.id });

      const result = await createService().restore(sourceOf(file), {
        userId: user.id,
        displayName: user.displayName,
      });

      expect(result).toEqual({ ok: true });
      const restored = snapshot(databaseFile);
      expect({
        ...restored,
        audit_log: restored.audit_log?.filter(
          (row) => (row as { action: string }).action !== "restore",
        ),
      }).toEqual(expected);
    });

    it("records exactly one restore row with the actor", async () => {
      const user = kit.signIn("cashier");
      const file = takeBackup();

      await createService().restore(sourceOf(file), {
        userId: user.id,
        displayName: user.displayName,
      });

      const rows = restoreRows(databaseFile);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.actor_user_id).toBe(user.id);
      const details = JSON.parse(rows[0]!.details) as Record<string, unknown>;
      expect(details).toMatchObject({
        fileName: basename(file),
        takenAt: "2026-11-01T00:00:00.000Z",
      });
      expect(details.preRestoreFile).toMatch(/^pre-restore-.*\.db$/);
      expect(details).not.toHaveProperty("actorName");
      expect(JSON.stringify(details)).not.toContain(kit.dir);
    });

    it("saves a row with no linked user when the actor is missing from the restored data", async () => {
      const file = takeBackup();
      const user = kit.signIn("newcomer");

      const result = await createService().restore(sourceOf(file), {
        userId: user.id,
        displayName: user.displayName,
      });

      expect(result).toEqual({ ok: true });
      const [row] = restoreRows(databaseFile);
      expect(row?.actor_user_id).toBeNull();
      expect(JSON.parse(row!.details)).toMatchObject({ actorName: "newcomer name" });
    });

    it("restores with no actor and no shift check, even with an open shift", async () => {
      const file = takeBackup();
      kit.signIn("cashier");
      kit.openShift();

      const result = await createService().restore(sourceOf(file), null);

      expect(result).toEqual({ ok: true });
      const [row] = restoreRows(databaseFile);
      expect(row?.actor_user_id).toBeNull();
      expect(JSON.parse(row!.details)).not.toHaveProperty("actorName");
    });

    it("brings an older backup up to date and backs it up first", async () => {
      const oldFolder = join(kit.dir, "old-migrations");
      cpSync(migrationsFolder, oldFolder, { recursive: true });
      const journalFile = join(oldFolder, "meta", "_journal.json");
      const journal = JSON.parse(readFileSync(journalFile, "utf8")) as { entries: unknown[] };
      journal.entries = journal.entries.slice(0, 15);
      writeFileSync(journalFile, JSON.stringify(journal));

      const oldFile = join(kit.dir, "old.db");
      const old = openDatabase(oldFile);
      runMigrations(old, { migrationsFolder: oldFolder, backupDir: join(kit.dir, "old-backups") });
      old.sqlite.exec(`
        INSERT INTO stores (id, name, created_at, updated_at) VALUES ('s1', 'Old', 1, 2);
        INSERT INTO terminals (id, store_id, code, created_at, updated_at) VALUES ('t1', 's1', 'T1', 1, 2);
        INSERT INTO users (id, username, display_name, password_hash, pin_hash, created_at, updated_at)
          VALUES ('01990000-0000-7000-8000-000000000001', 'owner', 'Owner', 'p', 'q', 1, 2);
      `);
      expect(
        old.sqlite
          .prepare(
            "SELECT \"notnull\" FROM pragma_table_info('audit_log') WHERE name = 'actor_user_id'",
          )
          .get(),
      ).toEqual({ notnull: 1 });
      old.sqlite.close();

      const result = await createService().restore(sourceOf(oldFile), {
        userId: "01990000-0000-7000-8000-000000000001",
        displayName: "Owner",
      });

      expect(result).toEqual({ ok: true });
      const restored = new Database(databaseFile, { readonly: true });
      try {
        expect(lastAppliedAt(restored)).toBe(latestMigrationAt(migrationsFolder));
      } finally {
        restored.close();
      }
      expect(readdirSync(backupDir).filter((name) => name.startsWith("pre-migrate-"))).toHaveLength(
        1,
      );
      expect(restoreRows(databaseFile)[0]?.actor_user_id).toBe(
        "01990000-0000-7000-8000-000000000001",
      );
    });
  });
});
