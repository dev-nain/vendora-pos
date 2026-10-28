import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { schema } from "./schema";

export function openDatabase(file: string) {
  const sqlite = new Database(file);
  if (sqlite.pragma("journal_mode = WAL", { simple: true }) !== "wal") {
    sqlite.close();
    throw new Error("SQLite could not enable WAL mode");
  }
  // NORMAL can drop the last committed transactions in WAL mode after a power cut.
  sqlite.pragma("synchronous = FULL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  // The first read creates the -wal and -shm files; until then a fresh database has neither.
  sqlite.pragma("user_version", { simple: true });
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export type VendoraDatabase = ReturnType<typeof openDatabase>;
