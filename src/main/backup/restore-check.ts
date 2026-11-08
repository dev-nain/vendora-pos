import { closeSync, openSync, readSync } from "node:fs";
import Database from "better-sqlite3";
import { z } from "zod";
import { lastAppliedAt, latestMigrationAt } from "../db/migrate";

export type BackupCheck =
  | { ok: true }
  | { ok: false; reason: "not-vendora" | "corrupt" | "newer-version" };

const sqliteHeader = Buffer.from("SQLite format 3\0", "latin1");
export const requiredTables = ["__drizzle_migrations", "stores", "terminals", "users", "audit_log"];
const appliedAtSchema = z.int().positive();

export function hasSqliteHeader(file: string): boolean {
  const fd = openSync(file, "r");
  try {
    const header = Buffer.alloc(sqliteHeader.length);
    const read = readSync(fd, header, 0, header.length, 0);
    return read === header.length && header.equals(sqliteHeader);
  } finally {
    closeSync(fd);
  }
}

function inspect(sqlite: Database.Database, migrationsFolder: string): BackupCheck {
  if (sqlite.pragma("integrity_check", { simple: true }) !== "ok") {
    return { ok: false, reason: "corrupt" };
  }
  const present = new Set(
    (
      sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((row) => row.name),
  );
  if (!requiredTables.every((table) => present.has(table))) {
    return { ok: false, reason: "not-vendora" };
  }
  for (const table of ["stores", "terminals"]) {
    if (!sqlite.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) {
      return { ok: false, reason: "not-vendora" };
    }
  }
  const applied = appliedAtSchema.safeParse(lastAppliedAt(sqlite));
  if (!applied.success) return { ok: false, reason: "not-vendora" };
  const latest = latestMigrationAt(migrationsFolder);
  if (latest !== null && applied.data > latest) return { ok: false, reason: "newer-version" };
  return { ok: true };
}

export async function checkBackup(file: string, migrationsFolder: string): Promise<BackupCheck> {
  if (!hasSqliteHeader(file)) return { ok: false, reason: "not-vendora" };
  let sqlite: Database.Database | null = null;
  try {
    sqlite = new Database(file, { readonly: true, fileMustExist: true });
    return inspect(sqlite, migrationsFolder);
  } catch (error) {
    if (error instanceof Database.SqliteError) return { ok: false, reason: "corrupt" };
    throw error;
  } finally {
    sqlite?.close();
  }
}
