import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { VendoraDatabase } from "./client";

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

function lastAppliedAt({ sqlite }: VendoraDatabase): number {
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
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  sqlite.prepare("VACUUM INTO ?").run(join(backupDir, `pre-migrate-${stamp}.db`));
}

export function runMigrations(
  database: VendoraDatabase,
  { migrationsFolder, backupDir }: MigrationOptions,
): MigrationResult {
  const journal = readJournal(migrationsFolder);
  if (!journal) return "no-journal";

  const applied = lastAppliedAt(database);
  if (!journal.entries.some((entry) => entry.when > applied)) return "up-to-date";

  if (hasUserTables(database)) backupBeforeMigrate(database, backupDir);
  migrate(database.db, { migrationsFolder });
  return "migrated";
}
