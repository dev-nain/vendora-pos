import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import { recoveryScanSchema, startupStateSchema } from "@shared/recovery";
import {
  authResultSchema,
  createFirstUserInputSchema,
  createFirstUserResultSchema,
  loginInputSchema,
  loginUserSchema,
  pinSwitchInputSchema,
  sessionStateSchema,
} from "@shared/auth";
import {
  categoryIdInputSchema,
  categorySchema,
  createCategoryInputSchema,
  createCategoryResultSchema,
  deleteCategoryResultSchema,
  renameCategoryInputSchema,
  renameCategoryResultSchema,
} from "@shared/categories";
import {
  actionResultSchema,
  addMiscInputSchema,
  addProductInputSchema,
  billResultSchema,
  completeSaleInputSchema,
  completeSaleResultSchema,
  currentBillSchema,
  draftIdInputSchema,
  holdInputSchema,
  lineIdInputSchema,
  scanInputSchema,
  setBillDiscountInputSchema,
  setDamagedInputSchema,
  updateLineInputSchema,
} from "@shared/checkout";
import { auditListQuerySchema, auditPageSchema, auditUsersSchema } from "@shared/audit";
import { appInfoSchema, ipcChannels } from "@shared/ipc";
import { printInvoiceResultSchema, saveInvoicePdfResultSchema } from "@shared/invoices";
import {
  negativeStockQuerySchema,
  negativeStockResultSchema,
  stockAdjustmentInputSchema,
  stockAdjustmentResultSchema,
  lowStockQuerySchema,
  lowStockResultSchema,
  stockHistoryQuerySchema,
  stockHistoryResultSchema,
  stockListQuerySchema,
  stockListResultSchema,
} from "@shared/inventory";
import { discountsReturnsVoidsResultSchema } from "@shared/discounts-returns-voids";
import {
  exportReportInputSchema,
  exportReportResultSchema,
  grossProfitByCategoryResultSchema,
  grossProfitByProductResultSchema,
  reportRangeSchema,
  salesByDayResultSchema,
  salesTaxSummaryResultSchema,
} from "@shared/reports";
import {
  cancelStocktakeResultSchema,
  pastStocktakesQuerySchema,
  pastStocktakesResultSchema,
  postStocktakeResultSchema,
  recordCountInputSchema,
  recordCountResultSchema,
  startStocktakeInputSchema,
  startStocktakeResultSchema,
  stocktakeIdInputSchema,
  stocktakeLinesQuerySchema,
  stocktakeLinesResultSchema,
  stocktakeReviewLinesQuerySchema,
  stocktakeReviewLinesResultSchema,
  stocktakeReviewResultSchema,
  stocktakeScanInputSchema,
  stocktakeScanResultSchema,
  stocktakeSummarySchema,
} from "@shared/stocktake";
import {
  addFromSaleInputSchema,
  returnableInputSchema,
  returnableResultSchema,
} from "@shared/returns";
import {
  getOrderResultSchema,
  orderIdInputSchema,
  orderListSchema,
  salesListQuerySchema,
} from "@shared/sales";
import {
  backupNowResultSchema,
  backupPasswordResultSchema,
  backupPasswordStatusSchema,
  changeBackupPasswordInputSchema,
  backupStatusSchema,
  chosenBackupSchema,
  restoreInputSchema,
  restoreResultSchema,
  turnOffBackupPasswordInputSchema,
  turnOnBackupPasswordInputSchema,
} from "@shared/backup";
import {
  barcodeLookupInputSchema,
  barcodeLookupSchema,
  bulkUpdateProductsInputSchema,
  bulkUpdateProductsResultSchema,
  catalogExportResultSchema,
  createProductInputSchema,
  createProductResultSchema,
  deleteProductResultSchema,
  getProductResultSchema,
  productIdInputSchema,
  productSchema,
  productSearchInputSchema,
  productSearchResultSchema,
  productStatusResultSchema,
  updateProductInputSchema,
  updateProductResultSchema,
} from "@shared/products";
import {
  countPhaseInputSchema,
  openDrawerForCountResultSchema,
  printerStatusSchema,
  printResultSchema,
  printShiftReportInputSchema,
  saleIdInputSchema,
  saleJobResultSchema,
} from "@shared/receipt";
import {
  marginThresholdInputSchema,
  marginThresholdSettingSchema,
  miscItemInputSchema,
  miscItemSettingSchema,
  printerSettingsSchema,
  receiptSettingsInputSchema,
  receiptSettingsSchema,
  secondCopyStatusSchema,
  scalePrefixesInputSchema,
  scalePrefixesSettingSchema,
  shiftVarianceInputSchema,
  shiftVarianceSettingSchema,
  windowsPrintersSchema,
} from "@shared/settings";
import {
  addCashMoveInputSchema,
  addCashMoveResultSchema,
  cashMoveIdInputSchema,
  closeShiftInputSchema,
  closeShiftResultSchema,
  deleteCashMoveResultSchema,
  denominationSchema,
  heldBillSummarySchema,
  openShiftInputSchema,
  openShiftResultSchema,
  shiftIdInputSchema,
  shiftReportResultSchema,
  shiftStateSchema,
} from "@shared/shifts";
import {
  createTaxCategoryInputSchema,
  createTaxCategoryResultSchema,
  deleteTaxCategoryResultSchema,
  taxCategoryIdInputSchema,
  taxCategorySchema,
  updateTaxCategoryInputSchema,
  updateTaxCategoryResultSchema,
} from "@shared/tax-categories";
import {
  getGoodsReceivedResultSchema,
  goodsReceivedIdInputSchema,
  goodsReceivedLastCostInputSchema,
  goodsReceivedLastCostResultSchema,
  goodsReceivedListQuerySchema,
  goodsReceivedListResultSchema,
  lowMarginResultSchema,
  postGoodsReceivedInputSchema,
  postGoodsReceivedResultSchema,
} from "@shared/goods-received";
import {
  productPurchaseHistoryQuerySchema,
  productPurchaseHistoryResultSchema,
  supplierPurchaseHistoryQuerySchema,
  supplierPurchaseHistoryResultSchema,
} from "@shared/purchase-history";
import {
  getPurchaseReturnResultSchema,
  postPurchaseReturnInputSchema,
  postPurchaseReturnResultSchema,
  purchaseReturnIdInputSchema,
  purchaseReturnListQuerySchema,
  printPurchaseReturnResultSchema,
  purchaseReturnListResultSchema,
  savePurchaseReturnPdfResultSchema,
  purchaseReturnableInputSchema,
  purchaseReturnableNoteResultSchema,
  purchaseReturnableResultSchema,
} from "@shared/purchase-returns";
import {
  cancelPurchaseOrderResultSchema,
  confirmPurchaseOrderResultSchema,
  createPurchaseOrderInputSchema,
  createPurchaseOrderResultSchema,
  getPurchaseOrderResultSchema,
  purchaseOrderIdInputSchema,
  printPurchaseOrderResultSchema,
  purchaseOrderSummarySchema,
  savePurchaseOrderPdfResultSchema,
  updatePurchaseOrderInputSchema,
  updatePurchaseOrderResultSchema,
} from "@shared/purchase-orders";
import {
  createSupplierInputSchema,
  createSupplierResultSchema,
  supplierIdInputSchema,
  supplierListInputSchema,
  supplierSchema,
  supplierStatusResultSchema,
  updateSupplierInputSchema,
  updateSupplierResultSchema,
} from "@shared/suppliers";
import {
  createUserInputSchema,
  createUserResultSchema,
  deactivateUserResultSchema,
  managedUserSchema,
  resetPasswordInputSchema,
  resetPinInputSchema,
  updateUserInputSchema,
  updateUserResultSchema,
  userActionResultSchema,
  userIdInputSchema,
} from "@shared/users";
import { z } from "zod";
import { toIpcError } from "./ipc-errors";
import type { AuditLogService } from "./services/audit-log";
import type { AuthService } from "./services/auth";
import type { BillDraftsService } from "./services/bill-drafts";
import type { RecoveryService } from "./services/recovery";
import type { BackupAdminService } from "./services/backup-admin";
import type { BackupPasswordService } from "./services/backup-password";
import type { CatalogExportService } from "./services/catalog-export";
import type { CategoriesService } from "./services/categories";
import type { GoodsReceivedService } from "./services/goods-received";
import type { PurchaseReturnDocumentsService } from "./services/purchase-return-documents";
import type { PurchaseHistoryService } from "./services/purchase-history";
import type { PurchaseReturnsService } from "./services/purchase-returns";
import type { InventoryService } from "./services/inventory";
import type { StocktakeService } from "./services/stocktake";
import type { ProductsService } from "./services/products";
import type { PurchaseOrderDocumentsService } from "./services/purchase-order-documents";
import type { PurchaseOrdersService } from "./services/purchase-orders";
import type { SaleInvoicesService } from "./services/sale-invoices";
import type { ReceiptsService } from "./services/receipts";
import type { ReportsService } from "./services/reports";
import type { ReturnsService } from "./services/returns";
import type { SalesService } from "./services/sales";
import type { BackupSettingsService } from "./services/backup-settings";
import type { SettingsService } from "./services/settings";
import type { ShiftsService } from "./services/shifts";
import type { SuppliersService } from "./services/suppliers";
import type { TaxCategoriesService } from "./services/tax-categories";
import type { UsersService } from "./services/users";

function handle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await listener(event, ...args);
    } catch (error) {
      throw toIpcError(error);
    }
  });
}

export function registerStartupHandlers(recovery: RecoveryService): void {
  handle(ipcChannels.appGetInfo, () => appInfoSchema.parse({ version: app.getVersion() }));
  handle(ipcChannels.startupState, () => startupStateSchema.parse(recovery.state()));
  handle(ipcChannels.recoveryScan, async () => recoveryScanSchema.parse(await recovery.scan()));
  handle(ipcChannels.recoveryChooseFile, async () =>
    chosenBackupSchema.parse(await recovery.chooseFile()),
  );
  handle(ipcChannels.recoveryRestore, async (_event, input) =>
    restoreResultSchema.parse(await recovery.restore(restoreInputSchema.parse(input))),
  );
  handle(ipcChannels.recoveryRetry, () => recovery.retry());
}

interface IpcServices {
  auditLog: AuditLogService;
  auth: AuthService;
  backupSettings: BackupSettingsService;
  backupAdmin: BackupAdminService;
  backupPassword: BackupPasswordService;
  billDrafts: BillDraftsService;
  catalogExport: CatalogExportService;
  categories: CategoriesService;
  inventory: InventoryService;
  stocktake: StocktakeService;
  returns: ReturnsService;
  sales: SalesService;
  settings: SettingsService;
  shifts: ShiftsService;
  suppliers: SuppliersService;
  reports: ReportsService;
  taxCategories: TaxCategoriesService;
  users: UsersService;
  products: ProductsService;
  purchaseOrderDocuments: PurchaseOrderDocumentsService;
  purchaseOrders: PurchaseOrdersService;
  goodsReceived: GoodsReceivedService;
  purchaseReturns: PurchaseReturnsService;
  purchaseReturnDocuments: PurchaseReturnDocumentsService;
  purchaseHistory: PurchaseHistoryService;
  receipts: ReceiptsService;
  saleInvoices: SaleInvoicesService;
}

export function registerIpcHandlers({
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
  purchaseHistory,
  purchaseOrderDocuments,
  purchaseOrders,
  purchaseReturnDocuments,
  purchaseReturns,
  receipts,
  reports,
  returns,
  saleInvoices,
  sales,
  settings,
  shifts,
  suppliers,
  taxCategories,
  users,
}: IpcServices): void {
  handle(ipcChannels.authLogin, async (_event, input) =>
    authResultSchema.parse(await auth.login(loginInputSchema.parse(input))),
  );
  handle(ipcChannels.authSwitchByPin, async (_event, input) =>
    authResultSchema.parse(await auth.switchByPin(pinSwitchInputSchema.parse(input))),
  );
  handle(ipcChannels.authLogout, () => auth.logout());
  handle(ipcChannels.authCurrent, () => sessionStateSchema.nullable().parse(auth.current()));
  handle(ipcChannels.authListLoginUsers, () =>
    z.array(loginUserSchema).parse(auth.listLoginUsers()),
  );
  handle(ipcChannels.settingsSetScalePrefixes, (_event, input) =>
    scalePrefixesSettingSchema.parse(
      settings.setScalePrefixes(scalePrefixesInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.settingsGetMiscItemEnabled, () =>
    miscItemSettingSchema.parse(settings.getMiscItemEnabled()),
  );
  handle(ipcChannels.settingsSetMiscItemEnabled, (_event, input) =>
    miscItemSettingSchema.parse(settings.setMiscItemEnabled(miscItemInputSchema.parse(input))),
  );
  handle(ipcChannels.settingsGetShiftVarianceWarn, () =>
    shiftVarianceSettingSchema.parse(settings.getShiftVarianceWarn()),
  );
  handle(ipcChannels.settingsGetMarginThreshold, () =>
    marginThresholdSettingSchema.parse(settings.getMarginThreshold()),
  );
  handle(ipcChannels.settingsSetMarginThreshold, (_event, input) =>
    marginThresholdSettingSchema.parse(
      settings.setMarginThreshold(marginThresholdInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.settingsSetShiftVarianceWarn, (_event, input) =>
    shiftVarianceSettingSchema.parse(
      settings.setShiftVarianceWarn(shiftVarianceInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.settingsGetReceipt, () => receiptSettingsSchema.parse(settings.getReceipt()));
  handle(ipcChannels.settingsSetReceipt, (_event, input) =>
    receiptSettingsSchema.parse(settings.setReceipt(receiptSettingsInputSchema.parse(input))),
  );
  handle(ipcChannels.settingsGetSecondCopy, () =>
    secondCopyStatusSchema.parse(backupSettings.getSecondCopy()),
  );
  handle(ipcChannels.settingsChooseSecondCopyFolder, async () =>
    secondCopyStatusSchema.parse(await backupSettings.chooseSecondCopyFolder()),
  );
  handle(ipcChannels.settingsClearSecondCopyFolder, () =>
    secondCopyStatusSchema.parse(backupSettings.clearSecondCopyFolder()),
  );
  handle(ipcChannels.printerGetSettings, () => printerSettingsSchema.parse(settings.getPrinter()));
  handle(ipcChannels.printerSetSettings, (_event, input) =>
    printerSettingsSchema.parse(settings.setPrinter(printerSettingsSchema.parse(input))),
  );
  handle(ipcChannels.printerListWindows, async (event) =>
    windowsPrintersSchema.parse(
      await settings.listWindowsPrinters(async () =>
        (await event.sender.getPrintersAsync()).map(({ name, displayName, options }) => ({
          name,
          displayName,
          isDefault: (options as Record<string, unknown>)["is-default"] === "true",
        })),
      ),
    ),
  );
  handle(ipcChannels.printerStatus, () => printerStatusSchema.parse(receipts.status()));
  handle(ipcChannels.printerTestPrint, async () =>
    printResultSchema.parse(await receipts.testPrint()),
  );
  handle(ipcChannels.printerTestDrawer, async () =>
    printResultSchema.parse(await receipts.testDrawer()),
  );
  handle(ipcChannels.printerOpenDrawerForCount, async (_event, input) => {
    const { phase } = countPhaseInputSchema.parse(input);
    const open = shifts.state().status === "open";
    if (open !== (phase === "closing")) {
      return openDrawerForCountResultSchema.parse({
        ok: false,
        reason: "wrong-phase",
        message: "The drawer opens for a count only while that count is on screen.",
      });
    }
    await receipts.openDrawer(phase === "opening" ? "opening_count" : "closing_count");
    return openDrawerForCountResultSchema.parse({ ok: true });
  });
  handle(ipcChannels.receiptsSaleJob, async (_event, input) =>
    saleJobResultSchema.parse(await receipts.saleJob(saleIdInputSchema.parse(input))),
  );
  handle(ipcChannels.receiptsPrint, async (_event, input) =>
    printResultSchema.parse(await receipts.print(saleIdInputSchema.parse(input))),
  );
  handle(ipcChannels.receiptsPrintShiftReport, async (_event, input) =>
    printResultSchema.parse(
      await receipts.printShiftReport(printShiftReportInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.productsGetMiscItem, () =>
    productSchema.nullable().parse(products.miscItem()),
  );
  handle(ipcChannels.authNeedsSetup, () => z.boolean().parse(auth.needsSetup()));
  handle(ipcChannels.authCreateFirstUser, async (_event, input) =>
    createFirstUserResultSchema.parse(
      await auth.createFirstUser(createFirstUserInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.usersList, () => z.array(managedUserSchema).parse(users.list()));
  handle(ipcChannels.usersCreate, async (_event, input) =>
    createUserResultSchema.parse(await users.create(createUserInputSchema.parse(input))),
  );
  handle(ipcChannels.usersUpdate, (_event, input) =>
    updateUserResultSchema.parse(users.update(updateUserInputSchema.parse(input))),
  );
  handle(ipcChannels.usersResetPassword, async (_event, input) =>
    userActionResultSchema.parse(await users.resetPassword(resetPasswordInputSchema.parse(input))),
  );
  handle(ipcChannels.usersResetPin, async (_event, input) =>
    userActionResultSchema.parse(await users.resetPin(resetPinInputSchema.parse(input))),
  );
  handle(ipcChannels.usersDeactivate, (_event, input) =>
    deactivateUserResultSchema.parse(users.deactivate(userIdInputSchema.parse(input))),
  );
  handle(ipcChannels.usersReactivate, (_event, input) =>
    userActionResultSchema.parse(users.reactivate(userIdInputSchema.parse(input))),
  );
  handle(ipcChannels.inventoryListStock, (_event, input) =>
    stockListResultSchema.parse(inventory.list(stockListQuerySchema.parse(input))),
  );
  handle(ipcChannels.inventoryLowStock, (_event, input) =>
    lowStockResultSchema.parse(inventory.lowStock(lowStockQuerySchema.parse(input))),
  );
  handle(ipcChannels.inventoryStockHistory, (_event, input) =>
    stockHistoryResultSchema.parse(inventory.history(stockHistoryQuerySchema.parse(input))),
  );
  handle(ipcChannels.stocktakeCurrent, () =>
    stocktakeSummarySchema.nullable().parse(stocktake.current()),
  );
  handle(ipcChannels.stocktakeStart, (_event, input) =>
    startStocktakeResultSchema.parse(stocktake.start(startStocktakeInputSchema.parse(input))),
  );
  handle(ipcChannels.stocktakeLines, (_event, input) =>
    stocktakeLinesResultSchema.parse(stocktake.lines(stocktakeLinesQuerySchema.parse(input))),
  );
  handle(ipcChannels.stocktakeScan, (_event, input) =>
    stocktakeScanResultSchema.parse(stocktake.scan(stocktakeScanInputSchema.parse(input))),
  );
  handle(ipcChannels.stocktakeRecord, (_event, input) =>
    recordCountResultSchema.parse(stocktake.record(recordCountInputSchema.parse(input))),
  );
  handle(ipcChannels.stocktakeCancel, (_event, input) =>
    cancelStocktakeResultSchema.parse(stocktake.cancel(stocktakeIdInputSchema.parse(input))),
  );
  handle(ipcChannels.stocktakeReview, (_event, input) =>
    stocktakeReviewResultSchema.parse(stocktake.review(stocktakeIdInputSchema.parse(input))),
  );
  handle(ipcChannels.stocktakeReviewLines, (_event, input) =>
    stocktakeReviewLinesResultSchema.parse(
      stocktake.reviewLines(stocktakeReviewLinesQuerySchema.parse(input)),
    ),
  );
  handle(ipcChannels.stocktakePost, (_event, input) =>
    postStocktakeResultSchema.parse(stocktake.post(stocktakeIdInputSchema.parse(input))),
  );
  handle(ipcChannels.stocktakeListPast, (_event, input) =>
    pastStocktakesResultSchema.parse(stocktake.listPast(pastStocktakesQuerySchema.parse(input))),
  );
  handle(ipcChannels.inventoryNegativeStock, (_event, input) =>
    negativeStockResultSchema.parse(inventory.negativeStock(negativeStockQuerySchema.parse(input))),
  );
  handle(ipcChannels.inventoryAdjustStock, (_event, input) =>
    stockAdjustmentResultSchema.parse(
      inventory.adjustStock(stockAdjustmentInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.productsSearch, (_event, input) =>
    productSearchResultSchema.parse(products.search(productSearchInputSchema.parse(input))),
  );
  handle(ipcChannels.productsGet, (_event, input) =>
    getProductResultSchema.parse(products.get(productIdInputSchema.parse(input))),
  );
  handle(ipcChannels.productsCreate, (_event, input) =>
    createProductResultSchema.parse(products.create(createProductInputSchema.parse(input))),
  );
  handle(ipcChannels.productsUpdate, (_event, input) =>
    updateProductResultSchema.parse(products.update(updateProductInputSchema.parse(input))),
  );
  handle(ipcChannels.productsArchive, (_event, input) =>
    productStatusResultSchema.parse(products.archive(productIdInputSchema.parse(input))),
  );
  handle(ipcChannels.productsRestore, (_event, input) =>
    productStatusResultSchema.parse(products.restore(productIdInputSchema.parse(input))),
  );
  handle(ipcChannels.productsDelete, (_event, input) =>
    deleteProductResultSchema.parse(products.delete(productIdInputSchema.parse(input))),
  );
  handle(ipcChannels.productsBulkUpdate, (_event, input) =>
    bulkUpdateProductsResultSchema.parse(
      products.bulkUpdate(bulkUpdateProductsInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.productsLookupBarcode, (_event, input) =>
    barcodeLookupSchema
      .nullable()
      .parse(products.lookupBarcode(barcodeLookupInputSchema.parse(input))),
  );
  handle(ipcChannels.productsExportCsv, async () =>
    catalogExportResultSchema.parse(await catalogExport.exportCsv()),
  );
  handle(ipcChannels.categoriesList, () => z.array(categorySchema).parse(categories.list()));
  handle(ipcChannels.categoriesCreate, (_event, input) =>
    createCategoryResultSchema.parse(categories.create(createCategoryInputSchema.parse(input))),
  );
  handle(ipcChannels.categoriesRename, (_event, input) =>
    renameCategoryResultSchema.parse(categories.rename(renameCategoryInputSchema.parse(input))),
  );
  handle(ipcChannels.categoriesDelete, (_event, input) =>
    deleteCategoryResultSchema.parse(categories.remove(categoryIdInputSchema.parse(input))),
  );
  handle(ipcChannels.suppliersList, (_event, input) =>
    z.array(supplierSchema).parse(suppliers.list(supplierListInputSchema.parse(input ?? {}))),
  );
  handle(ipcChannels.suppliersCreate, (_event, input) =>
    createSupplierResultSchema.parse(suppliers.create(createSupplierInputSchema.parse(input))),
  );
  handle(ipcChannels.suppliersUpdate, (_event, input) =>
    updateSupplierResultSchema.parse(suppliers.update(updateSupplierInputSchema.parse(input))),
  );
  handle(ipcChannels.suppliersArchive, (_event, input) =>
    supplierStatusResultSchema.parse(suppliers.archive(supplierIdInputSchema.parse(input))),
  );
  handle(ipcChannels.suppliersRestore, (_event, input) =>
    supplierStatusResultSchema.parse(suppliers.restore(supplierIdInputSchema.parse(input))),
  );
  handle(ipcChannels.purchaseOrdersList, () =>
    z.array(purchaseOrderSummarySchema).parse(purchaseOrders.list()),
  );
  handle(ipcChannels.purchaseOrdersGet, (_event, input) =>
    getPurchaseOrderResultSchema.parse(purchaseOrders.get(purchaseOrderIdInputSchema.parse(input))),
  );
  handle(ipcChannels.purchaseOrdersCreate, (_event, input) =>
    createPurchaseOrderResultSchema.parse(
      purchaseOrders.create(createPurchaseOrderInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.purchaseOrdersUpdate, (_event, input) =>
    updatePurchaseOrderResultSchema.parse(
      purchaseOrders.update(updatePurchaseOrderInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.purchaseOrdersConfirm, (_event, input) =>
    confirmPurchaseOrderResultSchema.parse(
      purchaseOrders.confirm(purchaseOrderIdInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.purchaseOrdersCancel, (_event, input) =>
    cancelPurchaseOrderResultSchema.parse(
      purchaseOrders.cancel(purchaseOrderIdInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.goodsReceivedPost, (_event, input) =>
    postGoodsReceivedResultSchema.parse(
      goodsReceived.post(postGoodsReceivedInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.goodsReceivedList, (_event, input) =>
    goodsReceivedListResultSchema.parse(
      goodsReceived.list(goodsReceivedListQuerySchema.parse(input)),
    ),
  );
  handle(ipcChannels.goodsReceivedGet, (_event, input) =>
    getGoodsReceivedResultSchema.parse(goodsReceived.get(goodsReceivedIdInputSchema.parse(input))),
  );
  handle(ipcChannels.goodsReceivedLowMargin, (_event, input) =>
    lowMarginResultSchema.parse(goodsReceived.lowMargin(goodsReceivedIdInputSchema.parse(input))),
  );
  handle(ipcChannels.goodsReceivedLastCost, (_event, input) =>
    goodsReceivedLastCostResultSchema.parse(
      goodsReceived.lastCost(goodsReceivedLastCostInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.purchaseReturnsPost, (_event, input) =>
    postPurchaseReturnResultSchema.parse(
      purchaseReturns.post(postPurchaseReturnInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.purchaseReturnsList, (_event, input) =>
    purchaseReturnListResultSchema.parse(
      purchaseReturns.list(purchaseReturnListQuerySchema.parse(input)),
    ),
  );
  handle(ipcChannels.purchaseReturnsGet, (_event, input) =>
    getPurchaseReturnResultSchema.parse(
      purchaseReturns.get(purchaseReturnIdInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.purchaseReturnsReturnable, (_event, input) =>
    purchaseReturnableResultSchema.parse(
      purchaseReturns.returnable(purchaseReturnableInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.purchaseReturnsFromNote, (_event, input) =>
    purchaseReturnableNoteResultSchema.parse(
      purchaseReturns.fromNote(purchaseReturnIdInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.purchaseReturnsSavePdf, async (_event, input) =>
    savePurchaseReturnPdfResultSchema.parse(
      await purchaseReturnDocuments.savePdf(purchaseReturnIdInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.purchaseReturnsPrint, async (_event, input) =>
    printPurchaseReturnResultSchema.parse(
      await purchaseReturnDocuments.print(purchaseReturnIdInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.purchaseHistoryProduct, (_event, input) =>
    productPurchaseHistoryResultSchema.parse(
      purchaseHistory.forProduct(productPurchaseHistoryQuerySchema.parse(input)),
    ),
  );
  handle(ipcChannels.purchaseHistorySupplier, (_event, input) =>
    supplierPurchaseHistoryResultSchema.parse(
      purchaseHistory.forSupplier(supplierPurchaseHistoryQuerySchema.parse(input)),
    ),
  );
  handle(ipcChannels.purchaseOrdersSavePdf, async (_event, input) =>
    savePurchaseOrderPdfResultSchema.parse(
      await purchaseOrderDocuments.savePdf(purchaseOrderIdInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.purchaseOrdersPrint, async (_event, input) =>
    printPurchaseOrderResultSchema.parse(
      await purchaseOrderDocuments.print(purchaseOrderIdInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.invoicesSavePdf, async (_event, input) =>
    saveInvoicePdfResultSchema.parse(await saleInvoices.savePdf(saleIdInputSchema.parse(input))),
  );
  handle(ipcChannels.invoicesPrint, async (_event, input) =>
    printInvoiceResultSchema.parse(await saleInvoices.print(saleIdInputSchema.parse(input))),
  );
  handle(ipcChannels.reportsSalesByDay, (_event, input) =>
    salesByDayResultSchema.parse(reports.salesByDay(reportRangeSchema.parse(input))),
  );
  handle(ipcChannels.reportsExportSalesByDay, async (_event, input) =>
    exportReportResultSchema.parse(
      await reports.exportSalesByDay(exportReportInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.reportsSalesTaxSummary, (_event, input) =>
    salesTaxSummaryResultSchema.parse(reports.salesTaxSummary(reportRangeSchema.parse(input))),
  );
  handle(ipcChannels.reportsExportSalesTaxSummary, async (_event, input) =>
    exportReportResultSchema.parse(
      await reports.exportSalesTaxSummary(exportReportInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.reportsDiscountsReturnsVoids, (_event, input) =>
    discountsReturnsVoidsResultSchema.parse(
      reports.discountsReturnsVoids(reportRangeSchema.parse(input)),
    ),
  );
  handle(ipcChannels.reportsExportDiscountsReturnsVoids, async (_event, input) =>
    exportReportResultSchema.parse(
      await reports.exportDiscountsReturnsVoids(exportReportInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.reportsGrossProfitByProduct, (_event, input) =>
    grossProfitByProductResultSchema.parse(
      reports.grossProfitByProduct(reportRangeSchema.parse(input)),
    ),
  );
  handle(ipcChannels.reportsExportGrossProfitByProduct, async (_event, input) =>
    exportReportResultSchema.parse(
      await reports.exportGrossProfitByProduct(exportReportInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.reportsGrossProfitByCategory, (_event, input) =>
    grossProfitByCategoryResultSchema.parse(
      reports.grossProfitByCategory(reportRangeSchema.parse(input)),
    ),
  );
  handle(ipcChannels.reportsExportGrossProfitByCategory, async (_event, input) =>
    exportReportResultSchema.parse(
      await reports.exportGrossProfitByCategory(exportReportInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.taxCategoriesList, () =>
    z.array(taxCategorySchema).parse(taxCategories.list()),
  );
  handle(ipcChannels.taxCategoriesCreate, (_event, input) =>
    createTaxCategoryResultSchema.parse(
      taxCategories.create(createTaxCategoryInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.taxCategoriesUpdate, (_event, input) =>
    updateTaxCategoryResultSchema.parse(
      taxCategories.update(updateTaxCategoryInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.taxCategoriesDelete, (_event, input) =>
    deleteTaxCategoryResultSchema.parse(
      taxCategories.remove(taxCategoryIdInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.shiftsState, () => shiftStateSchema.parse(shifts.state()));
  handle(ipcChannels.shiftsOpen, (_event, input) =>
    openShiftResultSchema.parse(shifts.open(openShiftInputSchema.parse(input))),
  );
  handle(ipcChannels.shiftsAddCashMove, (_event, input) => {
    const parsed = addCashMoveInputSchema.parse(input);
    const result = addCashMoveResultSchema.parse(shifts.addCashMove(parsed));
    if (result.ok) void receipts.openDrawer(parsed.kind === "in" ? "cash_in" : "cash_out");
    return result;
  });
  handle(ipcChannels.shiftsDeleteCashMove, (_event, input) =>
    deleteCashMoveResultSchema.parse(shifts.deleteCashMove(cashMoveIdInputSchema.parse(input))),
  );
  handle(ipcChannels.shiftsReport, (_event, input) =>
    shiftReportResultSchema.parse(shifts.report(shiftIdInputSchema.parse(input))),
  );
  handle(ipcChannels.shiftsListDenominations, () =>
    z.array(denominationSchema).parse(shifts.listDenominations()),
  );
  handle(ipcChannels.shiftsClose, (_event, input) =>
    closeShiftResultSchema.parse(shifts.close(closeShiftInputSchema.parse(input))),
  );
  handle(ipcChannels.checkoutCurrent, () => currentBillSchema.parse(billDrafts.current()));
  handle(ipcChannels.checkoutScan, (_event, input) =>
    billResultSchema.parse(billDrafts.scan(scanInputSchema.parse(input))),
  );
  handle(ipcChannels.checkoutAddProduct, (_event, input) =>
    billResultSchema.parse(billDrafts.addProduct(addProductInputSchema.parse(input))),
  );
  handle(ipcChannels.checkoutAddMisc, (_event, input) =>
    billResultSchema.parse(billDrafts.addMisc(addMiscInputSchema.parse(input))),
  );
  handle(ipcChannels.checkoutUpdateLine, (_event, input) =>
    billResultSchema.parse(billDrafts.updateLine(updateLineInputSchema.parse(input))),
  );
  handle(ipcChannels.checkoutDeleteLine, (_event, input) =>
    billResultSchema.parse(billDrafts.deleteLine(lineIdInputSchema.parse(input))),
  );
  handle(ipcChannels.checkoutToggleReturn, (_event, input) =>
    billResultSchema.parse(billDrafts.toggleReturn(lineIdInputSchema.parse(input))),
  );
  handle(ipcChannels.checkoutSetDamaged, (_event, input) =>
    billResultSchema.parse(billDrafts.setDamaged(setDamagedInputSchema.parse(input))),
  );
  handle(ipcChannels.returnsReturnable, (_event, input) =>
    returnableResultSchema.parse(returns.returnable(returnableInputSchema.parse(input))),
  );
  handle(ipcChannels.returnsAddFromSale, (_event, input) =>
    billResultSchema.parse(returns.addFromSale(addFromSaleInputSchema.parse(input))),
  );
  handle(ipcChannels.checkoutSetBillDiscount, (_event, input) =>
    billResultSchema.parse(billDrafts.setBillDiscount(setBillDiscountInputSchema.parse(input))),
  );
  handle(ipcChannels.checkoutHold, (_event, input) =>
    actionResultSchema.parse(billDrafts.hold(holdInputSchema.parse(input))),
  );
  handle(ipcChannels.checkoutResume, (_event, input) =>
    billResultSchema.parse(billDrafts.resume(draftIdInputSchema.parse(input))),
  );
  handle(ipcChannels.checkoutListHeld, () =>
    z.array(heldBillSummarySchema).parse(billDrafts.listHeld()),
  );
  handle(ipcChannels.checkoutDiscard, (_event, input) =>
    actionResultSchema.parse(billDrafts.discard(draftIdInputSchema.parse(input))),
  );
  handle(ipcChannels.checkoutComplete, (_event, input) => {
    const result = completeSaleResultSchema.parse(
      sales.complete(completeSaleInputSchema.parse(input)),
    );
    if (result.ok && !result.sale.replayed) receipts.startAfterSale(result.sale.id);
    return result;
  });
  handle(ipcChannels.salesList, (_event, input) =>
    orderListSchema.parse(sales.list(salesListQuerySchema.parse(input))),
  );
  handle(ipcChannels.salesGet, (_event, input) =>
    getOrderResultSchema.parse(sales.get(orderIdInputSchema.parse(input))),
  );
  handle(ipcChannels.auditList, (_event, input) =>
    auditPageSchema.parse(auditLog.list(auditListQuerySchema.parse(input))),
  );
  handle(ipcChannels.auditUsers, () => auditUsersSchema.parse(auditLog.users()));
  handle(ipcChannels.backupStatus, async () =>
    backupStatusSchema.parse(await backupAdmin.status()),
  );
  handle(ipcChannels.backupRun, async () =>
    backupNowResultSchema.parse(await backupAdmin.backupNow()),
  );
  handle(ipcChannels.backupChooseFile, async () =>
    chosenBackupSchema.parse(await backupAdmin.chooseRestoreFile()),
  );
  handle(ipcChannels.backupRestore, async (_event, input) =>
    restoreResultSchema.parse(await backupAdmin.restore(restoreInputSchema.parse(input))),
  );
  handle(ipcChannels.backupPasswordStatus, async () =>
    backupPasswordStatusSchema.parse(await backupPassword.status()),
  );
  handle(ipcChannels.backupPasswordTurnOn, async (_event, input) =>
    backupPasswordResultSchema.parse(
      await backupPassword.turnOn(turnOnBackupPasswordInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.backupPasswordChange, async (_event, input) =>
    backupPasswordResultSchema.parse(
      await backupPassword.change(changeBackupPasswordInputSchema.parse(input)),
    ),
  );
  handle(ipcChannels.backupPasswordTurnOff, async (_event, input) =>
    backupPasswordResultSchema.parse(
      await backupPassword.turnOff(turnOffBackupPasswordInputSchema.parse(input)),
    ),
  );
}
