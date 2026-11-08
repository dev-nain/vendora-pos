import { removeStagedRestore } from "../backup/restore";
import { openDatabase, type VendoraDatabase } from "./client";
import { runMigrations } from "./migrate";
import { seedStoreAndTerminal } from "./seed";
import {
  checkDatabaseFile,
  classifyOpenError,
  logStartupFailure,
  type DamageCause,
  type OpenFailure,
} from "./startup-check";

export type StartupOutcome =
  | { mode: "normal"; database: VendoraDatabase; firstRun: boolean }
  | { mode: "damaged"; cause: DamageCause }
  | { mode: "open-failed"; failure: OpenFailure }
  | { mode: "newer-version" }
  | { mode: "migration-failed" };

interface StartupOptions {
  databaseFile: string;
  migrationsFolder: string;
  backupDir: string;
}

export async function openAppDatabase({
  databaseFile,
  migrationsFolder,
  backupDir,
}: StartupOptions): Promise<StartupOutcome> {
  await removeStagedRestore(databaseFile);
  const check = checkDatabaseFile(databaseFile, migrationsFolder);
  switch (check.status) {
    case "damaged":
      return { mode: "damaged", cause: check.cause };
    case "open-failed":
      return { mode: "open-failed", failure: check.failure };
    case "newer-version":
      return { mode: "newer-version" };
    case "missing":
    case "healthy":
      break;
  }

  let database: VendoraDatabase;
  try {
    database = openDatabase(databaseFile);
  } catch (error) {
    logStartupFailure(error);
    const verdict = classifyOpenError(error);
    return "damaged" in verdict
      ? { mode: "damaged", cause: verdict.damaged }
      : { mode: "open-failed", failure: verdict.failure };
  }

  try {
    const migration = runMigrations(database, { migrationsFolder, backupDir });
    if (migration !== "no-journal") seedStoreAndTerminal(database);
  } catch (error) {
    console.error("startup migration failed", error instanceof Error ? error.message : "");
    database.sqlite.close();
    return { mode: "migration-failed" };
  }
  return { mode: "normal", database, firstRun: check.status === "missing" };
}
