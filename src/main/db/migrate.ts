import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { VendoraDatabase } from "./client";
import { backupStamp, vacuumInto } from "./vacuum-into";

const MIGRATIONS_TABLE = "__drizzle_migrations";

interface Journal {
  entries: { when: number }[];
}

export type MigrationResult = "no-journal" | "up-to-date" | "migrated";

export interface MigrationOptions {
  migrationsFolder: string;
  backupDir: string;
}

function readJournal(migrationsFolder: string): Journal | null {
  const file = join(migrationsFolder, "meta", "_journal.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Journal;
}

export function latestMigrationAt(migrationsFolder: string): number | null {
  const journal = readJournal(migrationsFolder);
  if (!journal || journal.entries.length === 0) return null;
  return Math.max(...journal.entries.map((entry) => entry.when));
}

export function lastAppliedAt(sqlite: Database.Database): number {
  const table = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(MIGRATIONS_TABLE);
  if (!table) return -1;
  const row = sqlite.prepare(`SELECT max(created_at) AS at FROM ${MIGRATIONS_TABLE}`).get() as {
    at: number | null;
  };
  return row.at ?? -1;
}

function hasUserTables({ sqlite }: VendoraDatabase): boolean {
  const row = sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != ?",
    )
    .get(MIGRATIONS_TABLE);
  return row !== undefined;
}

function backupBeforeMigrate({ sqlite }: VendoraDatabase, backupDir: string): void {
  mkdirSync(backupDir, { recursive: true });
  vacuumInto(sqlite, join(backupDir, `pre-migrate-${backupStamp(new Date())}.db`));
}

export function runMigrations(
  database: VendoraDatabase,
  { migrationsFolder, backupDir }: MigrationOptions,
): MigrationResult {
  const journal = readJournal(migrationsFolder);
  if (!journal) return "no-journal";

  const applied = lastAppliedAt(database.sqlite);
  if (!journal.entries.some((entry) => entry.when > applied)) return "up-to-date";

  if (hasUserTables(database)) backupBeforeMigrate(database, backupDir);
  // drizzle runs migrations in a transaction, where PRAGMA foreign_keys is ignored.
  database.sqlite.pragma("foreign_keys = OFF");
  try {
    migrate(database.db, { migrationsFolder });
    const broken = database.sqlite.pragma("foreign_key_check") as unknown[];
    if (broken.length > 0) {
      throw new Error("Migration left broken references. Restore the pre-migrate backup.");
    }
  } finally {
    database.sqlite.pragma("foreign_keys = ON");
  }
  return "migrated";
}
