import { join } from "node:path";
import { app, BrowserWindow, dialog } from "electron";
import { openDatabase, type VendoraDatabase } from "./db/client";
import { seedDevUsers } from "./db/dev-users";
import { runMigrations } from "./db/migrate";
import { seedStoreAndTerminal } from "./db/seed";
import { registerIpcHandlers } from "./ipc";
import { createAuditService } from "./services/audit";
import { createAuthService } from "./services/auth";
import { createBillDraftsService } from "./services/bill-drafts";
import { createCatalogExportService } from "./services/catalog-export";
import { createCategoriesService } from "./services/categories";
import { createReceiptsService } from "./services/receipts";
import { createReturnsService } from "./services/returns";
import { createSalesService } from "./services/sales";
import { createSettingsService } from "./services/settings";
import { createShiftsService } from "./services/shifts";
import { createInventoryService } from "./services/inventory";
import { createStocktakeService } from "./services/stocktake";
import { createProductsService } from "./services/products";
import { createStockService } from "./services/stock";
import { createTaxCategoriesService } from "./services/tax-categories";
import { createUsersService } from "./services/users";
import { createSessionStore } from "./auth/session";
import { createRasteriser } from "./receipts/rasterise";
import { createRenderWindow } from "./receipts/render-window";
import { createTransport } from "./hardware/printer-transport";
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
  const audit = createAuditService(database);
  const sessions = createSessionStore();
  const auth = createAuthService({ database, audit, sessions });
  const settings = createSettingsService({ database, audit, sessions });
  const stock = createStockService({ database, audit });
  const billDrafts = createBillDraftsService({ database, audit, sessions });
  const sales = createSalesService({ database, audit, sessions, stock });
  const returns = createReturnsService({ database, sessions });
  const shifts = createShiftsService({
    database,
    audit,
    sessions,
    heldBills: billDrafts.heldBillsFor,
  });
  const users = createUsersService({ database, audit, sessions });
  const products = createProductsService({ database, audit, sessions });
  const inventory = createInventoryService({ database, sessions, stock });
  const stocktake = createStocktakeService({ database, sessions, stock });
  const categories = createCategoriesService({ database, audit, sessions });
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
    auth,
    billDrafts,
    catalogExport,
    categories,
    inventory,
    stocktake,
    products,
    receipts,
    returns,
    sales,
    settings,
    shifts,
    taxCategories,
    users,
  });
  void renderWindow.warm().catch(() => undefined);
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
