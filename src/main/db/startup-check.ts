import { statSync } from "node:fs";
import Database from "better-sqlite3";
import { hasSqliteHeader, requiredTables } from "../backup/restore-check";
import { lastAppliedAt, latestMigrationAt } from "./migrate";

export type DamageCause = "corrupt" | "not-a-database" | "empty" | "not-vendora";
export type OpenFailure = "in-use" | "access-denied" | "unreadable";
export type FileCheck =
  | { status: "missing" }
  | { status: "healthy" }
  | { status: "damaged"; cause: DamageCause }
  | { status: "newer-version" }
  | { status: "open-failed"; failure: OpenFailure };

export const STARTUP_CHECK: "quick_check" | "integrity_check" = "quick_check";

export type ErrorVerdict = { damaged: DamageCause } | { failure: OpenFailure };

export function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return "";
}

export function classifyOpenError(error: unknown): ErrorVerdict {
  const code = errorCode(error);
  if (code.startsWith("SQLITE_CORRUPT")) return { damaged: "corrupt" };
  if (code === "SQLITE_NOTADB") return { damaged: "not-a-database" };
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" || code === "EBUSY") {
    return { failure: "in-use" };
  }
  if (
    code === "SQLITE_CANTOPEN" ||
    code === "SQLITE_PERM" ||
    code === "SQLITE_AUTH" ||
    code.startsWith("SQLITE_READONLY") ||
    code === "EACCES" ||
    code === "EPERM"
  ) {
    return { failure: "access-denied" };
  }
  return { failure: "unreadable" };
}

export function logStartupFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error("startup check failed", errorCode(error), message);
}

function inspect(file: string, migrationsFolder: string, check: string): FileCheck {
  const sqlite = new Database(file, { readonly: true, fileMustExist: true });
  try {
    if (sqlite.pragma(check, { simple: true }) !== "ok") {
      return { status: "damaged", cause: "corrupt" };
    }
    const present = new Set(
      (
        sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
          name: string;
        }[]
      ).map((row) => row.name),
    );
    if (!requiredTables.every((table) => present.has(table))) {
      return { status: "damaged", cause: "not-vendora" };
    }
    const latest = latestMigrationAt(migrationsFolder);
    if (latest !== null && lastAppliedAt(sqlite) > latest) return { status: "newer-version" };
    return { status: "healthy" };
  } finally {
    sqlite.close();
  }
}

export function checkDatabaseFile(
  file: string,
  migrationsFolder: string,
  check: string = STARTUP_CHECK,
): FileCheck {
  try {
    if (statSync(file).size === 0) return { status: "damaged", cause: "empty" };
    if (!hasSqliteHeader(file)) return { status: "damaged", cause: "not-a-database" };
    return inspect(file, migrationsFolder, check);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { status: "missing" };
    logStartupFailure(error);
    const verdict = classifyOpenError(error);
    return "damaged" in verdict
      ? { status: "damaged", cause: verdict.damaged }
      : { status: "open-failed", failure: verdict.failure };
  }
}
