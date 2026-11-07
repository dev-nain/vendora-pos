import { z } from "zod";
import { contextBridge, ipcRenderer } from "electron";
import { auditPageSchema, auditUsersSchema } from "@shared/audit";
import {
  backupNowResultSchema,
  backupPasswordResultSchema,
  backupPasswordStatusSchema,
  backupStatusSchema,
  chosenBackupSchema,
  restoreResultSchema,
} from "@shared/backup";
import {
  authResultSchema,
  createFirstUserResultSchema,
  loginUserSchema,
  sessionStateSchema,
} from "@shared/auth";
import {
  openDrawerForCountResultSchema,
  printerStatusSchema,
  printResultSchema,
  saleJobResultSchema,
} from "@shared/receipt";
import {
  miscItemSettingSchema,
  printerSettingsSchema,
  receiptSettingsSchema,
  secondCopyStatusSchema,
  scalePrefixesSettingSchema,
  shiftVarianceSettingSchema,
  windowsPrintersSchema,
} from "@shared/settings";
import {
  actionResultSchema,
  billResultSchema,
  completeSaleResultSchema,
  currentBillSchema,
} from "@shared/checkout";
import {
  addCashMoveResultSchema,
  closeShiftResultSchema,
  deleteCashMoveResultSchema,
  denominationSchema,
  heldBillSummarySchema,
  openShiftResultSchema,
  shiftReportResultSchema,
  shiftStateSchema,
} from "@shared/shifts";
import { appInfoSchema, ipcChannels, type VendoraApi } from "@shared/ipc";
import {
  cancelStocktakeResultSchema,
  recordCountResultSchema,
  startStocktakeResultSchema,
  stocktakeLinesResultSchema,
  stocktakeScanResultSchema,
  stocktakeSummarySchema,
} from "@shared/stocktake";
import {
  negativeStockResultSchema,
  stockAdjustmentResultSchema,
  lowStockResultSchema,
  stockHistoryResultSchema,
  stockListResultSchema,
} from "@shared/inventory";
import { returnableResultSchema } from "@shared/returns";
import { getOrderResultSchema, orderListSchema } from "@shared/sales";
import {
  barcodeLookupSchema,
  bulkUpdateProductsResultSchema,
  catalogExportResultSchema,
  createProductResultSchema,
  deleteProductResultSchema,
  getProductResultSchema,
  productSchema,
  productSearchResultSchema,
  productStatusResultSchema,
  updateProductResultSchema,
} from "@shared/products";
import {
  categorySchema,
  createCategoryResultSchema,
  deleteCategoryResultSchema,
  renameCategoryResultSchema,
} from "@shared/categories";
import {
  createTaxCategoryResultSchema,
  deleteTaxCategoryResultSchema,
  taxCategorySchema,
  updateTaxCategoryResultSchema,
} from "@shared/tax-categories";
import { postGoodsReceivedResultSchema } from "@shared/goods-received";
import {
  cancelPurchaseOrderResultSchema,
  confirmPurchaseOrderResultSchema,
  createPurchaseOrderResultSchema,
  getPurchaseOrderResultSchema,
  purchaseOrderSummarySchema,
  updatePurchaseOrderResultSchema,
} from "@shared/purchase-orders";
import {
  createSupplierResultSchema,
  supplierSchema,
  supplierStatusResultSchema,
  updateSupplierResultSchema,
} from "@shared/suppliers";
import {
  createUserResultSchema,
  deactivateUserResultSchema,
  managedUserSchema,
  updateUserResultSchema,
  userActionResultSchema,
} from "@shared/users";

const api: VendoraApi = {
  app: {
    getInfo: async () => appInfoSchema.parse(await ipcRenderer.invoke(ipcChannels.appGetInfo)),
  },
  auth: {
    login: async (username, password) =>
      authResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.authLogin, { username, password }),
      ),
    switchByPin: async (userId, pin) =>
      authResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.authSwitchByPin, { userId, pin }),
      ),
    logout: async () => {
      await ipcRenderer.invoke(ipcChannels.authLogout);
    },
    current: async () =>
      sessionStateSchema.nullable().parse(await ipcRenderer.invoke(ipcChannels.authCurrent)),
    listLoginUsers: async () =>
      z.array(loginUserSchema).parse(await ipcRenderer.invoke(ipcChannels.authListLoginUsers)),
    needsSetup: async () => z.boolean().parse(await ipcRenderer.invoke(ipcChannels.authNeedsSetup)),
    createFirstUser: async (input) =>
      createFirstUserResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.authCreateFirstUser, input),
      ),
  },
  settings: {
    setScalePrefixes: async (input) =>
      scalePrefixesSettingSchema.parse(
        await ipcRenderer.invoke(ipcChannels.settingsSetScalePrefixes, input),
      ),
    getMiscItemEnabled: async () =>
      miscItemSettingSchema.parse(await ipcRenderer.invoke(ipcChannels.settingsGetMiscItemEnabled)),
    setMiscItemEnabled: async (enabled) =>
      miscItemSettingSchema.parse(
        await ipcRenderer.invoke(ipcChannels.settingsSetMiscItemEnabled, { enabled }),
      ),
    getShiftVarianceWarn: async () =>
      shiftVarianceSettingSchema.parse(
        await ipcRenderer.invoke(ipcChannels.settingsGetShiftVarianceWarn),
      ),
    setShiftVarianceWarn: async (warnPaisa) =>
      shiftVarianceSettingSchema.parse(
        await ipcRenderer.invoke(ipcChannels.settingsSetShiftVarianceWarn, { warnPaisa }),
      ),
    getReceipt: async () =>
      receiptSettingsSchema.parse(await ipcRenderer.invoke(ipcChannels.settingsGetReceipt)),
    getSecondCopy: async () =>
      secondCopyStatusSchema.parse(await ipcRenderer.invoke(ipcChannels.settingsGetSecondCopy)),
    chooseSecondCopyFolder: async () =>
      secondCopyStatusSchema.parse(
        await ipcRenderer.invoke(ipcChannels.settingsChooseSecondCopyFolder),
      ),
    clearSecondCopyFolder: async () =>
      secondCopyStatusSchema.parse(
        await ipcRenderer.invoke(ipcChannels.settingsClearSecondCopyFolder),
      ),
    setReceipt: async (input) =>
      receiptSettingsSchema.parse(await ipcRenderer.invoke(ipcChannels.settingsSetReceipt, input)),
  },
  printer: {
    getSettings: async () =>
      printerSettingsSchema.parse(await ipcRenderer.invoke(ipcChannels.printerGetSettings)),
    setSettings: async (input) =>
      printerSettingsSchema.parse(await ipcRenderer.invoke(ipcChannels.printerSetSettings, input)),
    listWindows: async () =>
      windowsPrintersSchema.parse(await ipcRenderer.invoke(ipcChannels.printerListWindows)),
    status: async () =>
      printerStatusSchema.parse(await ipcRenderer.invoke(ipcChannels.printerStatus)),
    testPrint: async () =>
      printResultSchema.parse(await ipcRenderer.invoke(ipcChannels.printerTestPrint)),
    testDrawer: async () =>
      printResultSchema.parse(await ipcRenderer.invoke(ipcChannels.printerTestDrawer)),
    openDrawerForCount: async (phase) =>
      openDrawerForCountResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.printerOpenDrawerForCount, { phase }),
      ),
  },
  receipts: {
    saleJob: async (saleId) =>
      saleJobResultSchema.parse(await ipcRenderer.invoke(ipcChannels.receiptsSaleJob, { saleId })),
    print: async (saleId) =>
      printResultSchema.parse(await ipcRenderer.invoke(ipcChannels.receiptsPrint, { saleId })),
    printShiftReport: async (shiftId) =>
      printResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.receiptsPrintShiftReport, { shiftId }),
      ),
  },
  users: {
    list: async () =>
      z.array(managedUserSchema).parse(await ipcRenderer.invoke(ipcChannels.usersList)),
    create: async (input) =>
      createUserResultSchema.parse(await ipcRenderer.invoke(ipcChannels.usersCreate, input)),
    update: async (input) =>
      updateUserResultSchema.parse(await ipcRenderer.invoke(ipcChannels.usersUpdate, input)),
    resetPassword: async (id, password) =>
      userActionResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.usersResetPassword, { id, password }),
      ),
    resetPin: async (id, pin) =>
      userActionResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.usersResetPin, { id, pin }),
      ),
    deactivate: async (id) =>
      deactivateUserResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.usersDeactivate, { id }),
      ),
    reactivate: async (id) =>
      userActionResultSchema.parse(await ipcRenderer.invoke(ipcChannels.usersReactivate, { id })),
  },
  inventory: {
    listStock: async (query) =>
      stockListResultSchema.parse(await ipcRenderer.invoke(ipcChannels.inventoryListStock, query)),
    stockHistory: async (query) =>
      stockHistoryResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.inventoryStockHistory, query),
      ),
    negativeStock: async (query) =>
      negativeStockResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.inventoryNegativeStock, query),
      ),
    adjustStock: async (input) =>
      stockAdjustmentResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.inventoryAdjustStock, input),
      ),
    lowStock: async (query) =>
      lowStockResultSchema.parse(await ipcRenderer.invoke(ipcChannels.inventoryLowStock, query)),
  },
  stocktake: {
    current: async () =>
      stocktakeSummarySchema
        .nullable()
        .parse(await ipcRenderer.invoke(ipcChannels.stocktakeCurrent)),
    start: async (input) =>
      startStocktakeResultSchema.parse(await ipcRenderer.invoke(ipcChannels.stocktakeStart, input)),
    lines: async (query) =>
      stocktakeLinesResultSchema.parse(await ipcRenderer.invoke(ipcChannels.stocktakeLines, query)),
    scan: async (input) =>
      stocktakeScanResultSchema.parse(await ipcRenderer.invoke(ipcChannels.stocktakeScan, input)),
    record: async (input) =>
      recordCountResultSchema.parse(await ipcRenderer.invoke(ipcChannels.stocktakeRecord, input)),
    cancel: async (stocktakeId) =>
      cancelStocktakeResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.stocktakeCancel, { stocktakeId }),
      ),
  },
  products: {
    getMiscItem: async () =>
      productSchema.nullable().parse(await ipcRenderer.invoke(ipcChannels.productsGetMiscItem)),
    search: async (input) =>
      productSearchResultSchema.parse(await ipcRenderer.invoke(ipcChannels.productsSearch, input)),
    get: async (id) =>
      getProductResultSchema.parse(await ipcRenderer.invoke(ipcChannels.productsGet, { id })),
    create: async (input) =>
      createProductResultSchema.parse(await ipcRenderer.invoke(ipcChannels.productsCreate, input)),
    update: async (input) =>
      updateProductResultSchema.parse(await ipcRenderer.invoke(ipcChannels.productsUpdate, input)),
    archive: async (id) =>
      productStatusResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.productsArchive, { id }),
      ),
    restore: async (id) =>
      productStatusResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.productsRestore, { id }),
      ),
    delete: async (id) =>
      deleteProductResultSchema.parse(await ipcRenderer.invoke(ipcChannels.productsDelete, { id })),
    bulkUpdate: async (input) =>
      bulkUpdateProductsResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.productsBulkUpdate, input),
      ),
    lookupBarcode: async (barcode) =>
      barcodeLookupSchema
        .nullable()
        .parse(await ipcRenderer.invoke(ipcChannels.productsLookupBarcode, { barcode })),
    exportCsv: async () =>
      catalogExportResultSchema.parse(await ipcRenderer.invoke(ipcChannels.productsExportCsv)),
  },
  categories: {
    list: async () =>
      z.array(categorySchema).parse(await ipcRenderer.invoke(ipcChannels.categoriesList)),
    create: async (name) =>
      createCategoryResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.categoriesCreate, { name }),
      ),
    rename: async (id, name) =>
      renameCategoryResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.categoriesRename, { id, name }),
      ),
    remove: async (id) =>
      deleteCategoryResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.categoriesDelete, { id }),
      ),
  },
  taxCategories: {
    list: async () =>
      z.array(taxCategorySchema).parse(await ipcRenderer.invoke(ipcChannels.taxCategoriesList)),
    create: async (input) =>
      createTaxCategoryResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.taxCategoriesCreate, input),
      ),
    update: async (input) =>
      updateTaxCategoryResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.taxCategoriesUpdate, input),
      ),
    remove: async (id) =>
      deleteTaxCategoryResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.taxCategoriesDelete, { id }),
      ),
  },
  suppliers: {
    list: async (input) =>
      z
        .array(supplierSchema)
        .parse(await ipcRenderer.invoke(ipcChannels.suppliersList, input ?? {})),
    create: async (input) =>
      createSupplierResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.suppliersCreate, input),
      ),
    update: async (input) =>
      updateSupplierResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.suppliersUpdate, input),
      ),
    archive: async (id) =>
      supplierStatusResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.suppliersArchive, { id }),
      ),
    restore: async (id) =>
      supplierStatusResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.suppliersRestore, { id }),
      ),
  },
  purchaseOrders: {
    list: async () =>
      z
        .array(purchaseOrderSummarySchema)
        .parse(await ipcRenderer.invoke(ipcChannels.purchaseOrdersList)),
    get: async (id) =>
      getPurchaseOrderResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.purchaseOrdersGet, { id }),
      ),
    create: async (input) =>
      createPurchaseOrderResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.purchaseOrdersCreate, input),
      ),
    update: async (input) =>
      updatePurchaseOrderResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.purchaseOrdersUpdate, input),
      ),
    confirm: async (id) =>
      confirmPurchaseOrderResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.purchaseOrdersConfirm, { id }),
      ),
    cancel: async (id) =>
      cancelPurchaseOrderResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.purchaseOrdersCancel, { id }),
      ),
  },
  goodsReceived: {
    post: async (input) =>
      postGoodsReceivedResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.goodsReceivedPost, input),
      ),
  },
  shifts: {
    state: async () => shiftStateSchema.parse(await ipcRenderer.invoke(ipcChannels.shiftsState)),
    open: async (openingFloatPaisa) =>
      openShiftResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.shiftsOpen, { openingFloatPaisa }),
      ),
    addCashMove: async (input) =>
      addCashMoveResultSchema.parse(await ipcRenderer.invoke(ipcChannels.shiftsAddCashMove, input)),
    deleteCashMove: async (id) =>
      deleteCashMoveResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.shiftsDeleteCashMove, { id }),
      ),
    report: async (id) =>
      shiftReportResultSchema.parse(await ipcRenderer.invoke(ipcChannels.shiftsReport, { id })),
    listDenominations: async () =>
      z
        .array(denominationSchema)
        .parse(await ipcRenderer.invoke(ipcChannels.shiftsListDenominations)),
    close: async (input) =>
      closeShiftResultSchema.parse(await ipcRenderer.invoke(ipcChannels.shiftsClose, input)),
  },
  checkout: {
    current: async () =>
      currentBillSchema.parse(await ipcRenderer.invoke(ipcChannels.checkoutCurrent)),
    scan: async (input) =>
      billResultSchema.parse(await ipcRenderer.invoke(ipcChannels.checkoutScan, input)),
    addProduct: async (input) =>
      billResultSchema.parse(await ipcRenderer.invoke(ipcChannels.checkoutAddProduct, input)),
    addMisc: async (input) =>
      billResultSchema.parse(await ipcRenderer.invoke(ipcChannels.checkoutAddMisc, input)),
    updateLine: async (input) =>
      billResultSchema.parse(await ipcRenderer.invoke(ipcChannels.checkoutUpdateLine, input)),
    deleteLine: async (lineId) =>
      billResultSchema.parse(await ipcRenderer.invoke(ipcChannels.checkoutDeleteLine, { lineId })),
    toggleReturn: async (lineId) =>
      billResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.checkoutToggleReturn, { lineId }),
      ),
    setDamaged: async (input) =>
      billResultSchema.parse(await ipcRenderer.invoke(ipcChannels.checkoutSetDamaged, input)),
    setBillDiscount: async (input) =>
      billResultSchema.parse(await ipcRenderer.invoke(ipcChannels.checkoutSetBillDiscount, input)),
    hold: async (input) =>
      actionResultSchema.parse(await ipcRenderer.invoke(ipcChannels.checkoutHold, input)),
    resume: async (draftId) =>
      billResultSchema.parse(await ipcRenderer.invoke(ipcChannels.checkoutResume, { draftId })),
    listHeld: async () =>
      z.array(heldBillSummarySchema).parse(await ipcRenderer.invoke(ipcChannels.checkoutListHeld)),
    discard: async (draftId) =>
      actionResultSchema.parse(await ipcRenderer.invoke(ipcChannels.checkoutDiscard, { draftId })),
    complete: async (input) =>
      completeSaleResultSchema.parse(await ipcRenderer.invoke(ipcChannels.checkoutComplete, input)),
  },
  returns: {
    returnable: async (saleId) =>
      returnableResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.returnsReturnable, { saleId }),
      ),
    addFromSale: async (input) =>
      billResultSchema.parse(await ipcRenderer.invoke(ipcChannels.returnsAddFromSale, input)),
  },
  sales: {
    list: async (query) =>
      orderListSchema.parse(await ipcRenderer.invoke(ipcChannels.salesList, query)),
    get: async (id) =>
      getOrderResultSchema.parse(await ipcRenderer.invoke(ipcChannels.salesGet, { id })),
  },
  audit: {
    list: async (query) =>
      auditPageSchema.parse(await ipcRenderer.invoke(ipcChannels.auditList, query)),
    listUsers: async () => auditUsersSchema.parse(await ipcRenderer.invoke(ipcChannels.auditUsers)),
  },
  backup: {
    status: async () =>
      backupStatusSchema.parse(await ipcRenderer.invoke(ipcChannels.backupStatus)),
    run: async () => backupNowResultSchema.parse(await ipcRenderer.invoke(ipcChannels.backupRun)),
    chooseFile: async () =>
      chosenBackupSchema.parse(await ipcRenderer.invoke(ipcChannels.backupChooseFile)),
    restore: async (input) =>
      restoreResultSchema.parse(await ipcRenderer.invoke(ipcChannels.backupRestore, input)),
    passwordStatus: async () =>
      backupPasswordStatusSchema.parse(await ipcRenderer.invoke(ipcChannels.backupPasswordStatus)),
    turnOnPassword: async (password) =>
      backupPasswordResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.backupPasswordTurnOn, { password }),
      ),
    changePassword: async (current, next) =>
      backupPasswordResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.backupPasswordChange, { current, next }),
      ),
    turnOffPassword: async (current) =>
      backupPasswordResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.backupPasswordTurnOff, { current }),
      ),
  },
};

contextBridge.exposeInMainWorld("vendora", api);
