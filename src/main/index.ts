import { join } from "node:path";
import { app, BrowserWindow } from "electron";
import { openDatabase, type VendoraDatabase } from "./db/client";
import { seedDevUsers } from "./db/dev-users";
import { runMigrations } from "./db/migrate";
import { seedStoreAndTerminal } from "./db/seed";
import { registerIpcHandlers } from "./ipc";
import { createAuditService } from "./services/audit";
import { createAuthService } from "./services/auth";
import { createUsersService } from "./services/users";
import { createApprovalStore } from "./auth/approvals";
import { createSessionStore } from "./auth/session";
import { createMainWindow } from "./window";

let database: VendoraDatabase | null = null;

function startDatabase(): VendoraDatabase {
  const userData = app.getPath("userData");
  const opened = openDatabase(join(userData, "vendora.db"));
  const migration = runMigrations(opened, {
    migrationsFolder: app.isPackaged
      ? join(process.resourcesPath, "drizzle")
      : join(app.getAppPath(), "drizzle"),
    backupDir: join(userData, "backups"),
  });
  if (migration !== "no-journal") seedStoreAndTerminal(opened);
  return opened;
}

void app.whenReady().then(async () => {
  database = startDatabase();
  if (!app.isPackaged && process.env.VENDORA_DEV_USERS === "1") await seedDevUsers(database);
  const sessions = createSessionStore();
  const approvals = createApprovalStore({ sessions });
  const audit = createAuditService(database);
  const auth = createAuthService({ database, audit, sessions, approvals });
  const users = createUsersService({ database, audit, sessions, approvals });
  registerIpcHandlers({ auth, users });
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("before-quit", () => {
  database?.sqlite.close();
  database = null;
});

app.on("window-all-closed", () => {
  app.quit();
});
