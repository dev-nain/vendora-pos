import { join } from "node:path";
import { app, BrowserWindow, dialog, safeStorage } from "electron";
import { createBackupKeyStore } from "./backup/backup-key";
import { createBackupService, type BackupService } from "./backup/backup-service";
import { createRestoreService, removeStagedRestore } from "./backup/restore";
import { createWorkerCopy } from "./backup/worker-copy";
import { openDatabase, type VendoraDatabase } from "./db/client";
import { seedDevUsers } from "./db/dev-users";
import { runMigrations } from "./db/migrate";
import { seedStoreAndTerminal } from "./db/seed";
import { registerIpcHandlers } from "./ipc";
import { createAuditService } from "./services/audit";
import { createAuthService } from "./services/auth";
import { createBackupSettingsService } from "./services/backup-settings";
import { createBackupAdminService } from "./services/backup-admin";
import { createBackupPasswordService } from "./services/backup-password";
import { createBillDraftsService } from "./services/bill-drafts";
import { createCatalogExportService } from "./services/catalog-export";
import { createAuditLogService } from "./services/audit-log";
import { createCategoriesService } from "./services/categories";
import { createGoodsReceivedService } from "./services/goods-received";
import { createPurchaseOrdersService } from "./services/purchase-orders";
import { createReceiptsService } from "./services/receipts";
import { createReturnsService } from "./services/returns";
import { createSalesService } from "./services/sales";
import { createSettingsService } from "./services/settings";
import { createShiftsService } from "./services/shifts";
import { createInventoryService } from "./services/inventory";
import { createStocktakeService } from "./services/stocktake";
import { createProductsService } from "./services/products";
import { createStockService } from "./services/stock";
import { createSuppliersService } from "./services/suppliers";
import { createTaxCategoriesService } from "./services/tax-categories";
import { createUsersService } from "./services/users";
import { createSessionStore } from "./auth/session";
import { createRasteriser } from "./receipts/rasterise";
import { createRenderWindow } from "./receipts/render-window";
import { createTransport } from "./hardware/printer-transport";
import { createMainWindow } from "./window";

let database: VendoraDatabase | null = null;
let backups: BackupService | null = null;
let backupsStopped = false;

const backupDir = () => join(app.getPath("userData"), "backups");
const databaseFile = () => join(app.getPath("userData"), "vendora.db");
const migrationsFolder = () =>
  app.isPackaged ? join(process.resourcesPath, "drizzle") : join(app.getAppPath(), "drizzle");

async function startDatabase(): Promise<VendoraDatabase> {
  await removeStagedRestore(databaseFile());
  const opened = openDatabase(databaseFile());
  const migration = runMigrations(opened, {
    migrationsFolder: migrationsFolder(),
    backupDir: backupDir(),
  });
  if (migration !== "no-journal") seedStoreAndTerminal(opened);
  return opened;
}

async function showOnTop(options: Electron.MessageBoxOptions): Promise<void> {
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  await (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options));
}

void app.whenReady().then(async () => {
  database = await startDatabase();
  if (!app.isPackaged && process.env.VENDORA_DEV_USERS === "1") await seedDevUsers(database);
  const audit = createAuditService(database);
  const keys = createBackupKeyStore({
    keyFile: join(app.getPath("userData"), "backup-key.json"),
    protector: {
      available: () => safeStorage.isAsyncEncryptionAvailable(),
      protect: (secret) => safeStorage.encryptStringAsync(secret),
      unprotect: async (blob) => (await safeStorage.decryptStringAsync(blob)).result,
    },
  });
  backups = createBackupService({
    database,
    audit,
    backupDir: backupDir(),
    seal: keys.seal,
    copy: createWorkerCopy(join(__dirname, "backup-worker.js")),
  });
  const sessions = createSessionStore();
  const auth = createAuthService({ database, audit, sessions });
  const settings = createSettingsService({ database, audit, sessions });
  const backupSettings = createBackupSettingsService({
    database,
    audit,
    sessions,
    chooseFolder: async () => {
      const options = {
        title: "Choose a folder for the second backup copy",
        properties: ["openDirectory" as const],
      };
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
  });
  const backupPassword = createBackupPasswordService({ database, audit, sessions, keys });
  const stock = createStockService({ database, audit });
  const billDrafts = createBillDraftsService({ database, audit, sessions });
  const sales = createSalesService({ database, audit, sessions, stock });
  const returns = createReturnsService({ database, sessions });
  const shifts = createShiftsService({
    database,
    audit,
    sessions,
    heldBills: billDrafts.heldBillsFor,
    afterClose: backups.afterShiftClose,
  });
  const auditLog = createAuditLogService({ database, sessions });
  const users = createUsersService({ database, audit, sessions });
  const products = createProductsService({ database, audit, sessions });
  const inventory = createInventoryService({ database, sessions, stock });
  const stocktake = createStocktakeService({ database, sessions, stock });
  const categories = createCategoriesService({ database, audit, sessions });
  const suppliers = createSuppliersService({ database, audit, sessions });
  const purchaseOrders = createPurchaseOrdersService({ database, audit, sessions });
  const goodsReceived = createGoodsReceivedService({ database, audit, sessions, stock });
  const taxCategories = createTaxCategoriesService({ database, audit, sessions });
  const catalogExport = createCatalogExportService({
    database,
    sessions,
    chooseSavePath: async (fileName) => {
      const options = {
        title: "Export catalog",
        defaultPath: join(app.getPath("documents"), fileName),
        filters: [{ name: "CSV file", extensions: ["csv"] }],
      };
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const result = parent
        ? await dialog.showSaveDialog(parent, options)
        : await dialog.showSaveDialog(options);
      return result.canceled || !result.filePath ? null : result.filePath;
    },
  });
  const restores = createRestoreService({
    databaseFile: databaseFile(),
    backupDir: backupDir(),
    migrationsFolder: migrationsFolder(),
    backupCurrent: backups.backupBeforeRestore,
    closeDatabase: async () => {
      await backups?.stop();
      backupsStopped = true;
      const current = database;
      if (!current) return;
      const [checkpoint] = current.sqlite.pragma("wal_checkpoint(TRUNCATE)") as {
        busy: number;
      }[];
      if (checkpoint?.busy !== 0) throw new Error("Database is busy");
      current.sqlite.close();
      database = null;
    },
    restart: async (failure) => {
      if (failure) {
        await showOnTop({ type: "error", title: "Vendora", message: failure });
      }
      app.relaunch();
      app.quit();
    },
  });
  const backupAdmin = createBackupAdminService({
    database,
    sessions,
    backups,
    restores,
    shifts,
    backupDir: backupDir(),
    chooseFile: async () => {
      const options = {
        title: "Choose a Vendora backup",
        defaultPath: backupDir(),
        properties: ["openFile" as const],
        filters: [{ name: "Vendora backup", extensions: ["db"] }],
      };
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
  });
  const fakePrinterDir = process.env["VENDORA_FAKE_PRINTER"];
  const renderWindow = createRenderWindow();
  const receipts = createReceiptsService({
    database,
    audit,
    sessions,
    shifts,
    rasterise: createRasteriser(renderWindow, Boolean(fakePrinterDir) && !app.isPackaged),
    transportFor: (connection) =>
      createTransport(connection, { fakePrinterDir, isPackaged: app.isPackaged }),
    ...(app.isPackaged ? {} : { log: (entry) => console.info("print job", entry) }),
  });
  registerIpcHandlers({
    auditLog,
    auth,
    backupSettings,
    backupAdmin,
    backupPassword,
    billDrafts,
    catalogExport,
    categories,
    goodsReceived,
    inventory,
    stocktake,
    products,
    purchaseOrders,
    receipts,
    returns,
    sales,
    settings,
    shifts,
    suppliers,
    taxCategories,
    users,
  });
  void renderWindow.warm().catch(() => undefined);
  createMainWindow();
  backups.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("before-quit", (event) => {
  if (backups && !backupsStopped) {
    event.preventDefault();
    void backups.stop().finally(() => {
      backupsStopped = true;
      app.quit();
    });
    return;
  }
  database?.sqlite.close();
  database = null;
});

app.on("window-all-closed", () => {
  app.quit();
});
