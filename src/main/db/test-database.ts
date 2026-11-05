import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type VendoraDatabase } from "./client";
import { runMigrations } from "./migrate";

let templateFile: string | undefined;

function buildTemplate(): string {
  const dir = mkdtempSync(join(tmpdir(), "vendora-template-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "template.db");
  const database = openDatabase(file);
  runMigrations(database, {
    migrationsFolder: join(process.cwd(), "drizzle"),
    backupDir: join(dir, "backups"),
  });
  // Closing the last connection checkpoints the WAL, so the file alone holds the schema.
  database.sqlite.close();
  return file;
}

export function openMigratedDatabase(file: string): VendoraDatabase {
  templateFile ??= buildTemplate();
  copyFileSync(templateFile, file);
  return openDatabase(file);
}
