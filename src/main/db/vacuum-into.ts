import type Database from "better-sqlite3";

export function vacuumInto(sqlite: Database.Database, file: string): void {
  sqlite.prepare("VACUUM INTO ?").run(file);
}

export function backupStamp(at: Date): string {
  return at.toISOString().replace(/[:.]/g, "-");
}
