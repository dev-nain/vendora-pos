import { z } from "zod";
import type { AuditListQuery, AuditPage, AuditUser } from "./audit";
import type {
  BackupNowResult,
  BackupPasswordResult,
  BackupPasswordStatus,
  BackupStatus,
  ChosenBackup,
  RestoreInput,
  RestoreResult,
} from "./backup";
import type {
  AuthResult,
  CreateFirstUserInput,
  CreateFirstUserResult,
  LoginUser,
  SessionState,
} from "./auth";
import type {
  Category,
  CreateCategoryResult,
  DeleteCategoryResult,
  RenameCategoryResult,
} from "./categories";
import type { PostGoodsReceivedInput, PostGoodsReceivedResult } from "./goods-received";
import type {
  CancelPurchaseOrderResult,
  ConfirmPurchaseOrderResult,
  CreatePurchaseOrderInput,
  CreatePurchaseOrderResult,
  GetPurchaseOrderResult,
  PrintPurchaseOrderResult,
  PurchaseOrderSummary,
  SavePurchaseOrderPdfResult,
  UpdatePurchaseOrderInput,
  UpdatePurchaseOrderResult,
} from "./purchase-orders";
import type {
  CreateSupplierInput,
  CreateSupplierResult,
  Supplier,
  SupplierListInput,
  SupplierStatusResult,
  UpdateSupplierInput,
  UpdateSupplierResult,
} from "./suppliers";
import type {
  CountPhase,
  OpenDrawerForCountResult,
  PrinterStatus,
  PrintResult,
  SaleJobResult,
} from "./receipt";
import type {
  MiscItemSetting,
  PrinterSettings,
  ReceiptSettings,
  ReceiptSettingsInput,
  SecondCopyStatus,
  ScalePrefixesInput,
  ScalePrefixesSetting,
  ShiftVarianceSetting,
  WindowsPrinter,
} from "./settings";
import type {
  AddCashMoveInput,
  AddCashMoveResult,
  CloseShiftInput,
  CloseShiftResult,
  DeleteCashMoveResult,
  Denomination,
  OpenShiftResult,
  ShiftReportResult,
  HeldBillSummary,
  ShiftState,
} from "./shifts";
import type {
  ActionResult,
  AddMiscInput,
  AddProductInput,
  BillResult,
  CompleteSaleInput,
  CompleteSaleResult,
  CurrentBill,
  HoldInput,
  ScanInput,
  SetBillDiscountInput,
  SetDamagedInput,
  UpdateLineInput,
} from "./checkout";
import type {
  NegativeStockQuery,
  NegativeStockResult,
  StockAdjustmentInput,
  StockAdjustmentResult,
  LowStockQuery,
  LowStockResult,
  StockHistoryQuery,
  StockHistoryResult,
  StockListQuery,
  StockListResult,
} from "./inventory";
import type { AddFromSaleInput, ReturnableResult } from "./returns";
import type {
  CancelStocktakeResult,
  RecordCountInput,
  RecordCountResult,
  StartStocktakeInput,
  StartStocktakeResult,
  StocktakeLinesQuery,
  StocktakeLinesResult,
  StocktakeScanInput,
  StocktakeScanResult,
  StocktakeSummary,
} from "./stocktake";
import type {
  BarcodeLookup,
  BulkUpdateProductsInput,
  BulkUpdateProductsResult,
  CatalogExportResult,
  CreateProductInput,
  CreateProductResult,
  DeleteProductResult,
  GetProductResult,
  Product,
  ProductSearchQuery,
  ProductSearchResult,
  ProductStatusResult,
  UpdateProductInput,
  UpdateProductResult,
} from "./products";
import type { GetOrderResult, OrderSummary, SalesListQuery } from "./sales";
import type {
  CreateTaxCategoryInput,
  CreateTaxCategoryResult,
  DeleteTaxCategoryResult,
  TaxCategory,
  UpdateTaxCategoryInput,
  UpdateTaxCategoryResult,
} from "./tax-categories";
import type {
  CreateUserInput,
  CreateUserResult,
  DeactivateUserResult,
  ManagedUser,
  UpdateUserInput,
  UpdateUserResult,
  UserActionResult,
} from "./users";

export const appInfoSchema = z.object({ version: z.string() });

export type AppInfo = z.infer<typeof appInfoSchema>;

export const ipcChannels = {
  appGetInfo: "app:get-info",
  authLogin: "auth:login",
  authSwitchByPin: "auth:switch-by-pin",
  authLogout: "auth:logout",
  authCurrent: "auth:current",
  authListLoginUsers: "auth:list-login-users",
  settingsSetScalePrefixes: "settings:set-scale-prefixes",
  settingsGetMiscItemEnabled: "settings:get-misc-item-enabled",
  settingsSetMiscItemEnabled: "settings:set-misc-item-enabled",
  settingsGetShiftVarianceWarn: "settings:get-shift-variance-warn",
  settingsSetShiftVarianceWarn: "settings:set-shift-variance-warn",
  settingsGetReceipt: "settings:get-receipt",
  settingsSetReceipt: "settings:set-receipt",
  settingsGetSecondCopy: "settings:get-second-copy",
  settingsChooseSecondCopyFolder: "settings:choose-second-copy-folder",
  settingsClearSecondCopyFolder: "settings:clear-second-copy-folder",
  printerGetSettings: "printer:get-settings",
  printerSetSettings: "printer:set-settings",
  printerListWindows: "printer:list-windows",
  printerStatus: "printer:status",
  printerTestPrint: "printer:test-print",
  printerTestDrawer: "printer:test-drawer",
  printerOpenDrawerForCount: "printer:open-drawer-for-count",
  receiptsSaleJob: "receipts:sale-job",
  receiptsPrint: "receipts:print",
  receiptsPrintShiftReport: "receipts:print-shift-report",
  authNeedsSetup: "auth:needs-setup",
  authCreateFirstUser: "auth:create-first-user",
  usersList: "users:list",
  usersCreate: "users:create",
  usersUpdate: "users:update",
  usersResetPassword: "users:reset-password",
  usersResetPin: "users:reset-pin",
  usersDeactivate: "users:deactivate",
  usersReactivate: "users:reactivate",
  inventoryListStock: "inventory:list-stock",
  inventoryStockHistory: "inventory:stock-history",
  stocktakeCurrent: "stocktake:current",
  stocktakeStart: "stocktake:start",
  stocktakeLines: "stocktake:lines",
  stocktakeScan: "stocktake:scan",
  stocktakeRecord: "stocktake:record",
  stocktakeCancel: "stocktake:cancel",
  inventoryNegativeStock: "inventory:negative-stock",
  inventoryAdjustStock: "inventory:adjust-stock",
  inventoryLowStock: "inventory:low-stock",
  productsSearch: "products:search",
  productsGet: "products:get",
  productsCreate: "products:create",
  productsUpdate: "products:update",
  productsArchive: "products:archive",
  productsRestore: "products:restore",
  productsDelete: "products:delete",
  productsBulkUpdate: "products:bulk-update",
  productsLookupBarcode: "products:lookup-barcode",
  productsExportCsv: "products:export-csv",
  productsGetMiscItem: "products:get-misc-item",
  categoriesList: "categories:list",
  categoriesCreate: "categories:create",
  categoriesRename: "categories:rename",
  categoriesDelete: "categories:delete",
  taxCategoriesList: "tax-categories:list",
  taxCategoriesCreate: "tax-categories:create",
  taxCategoriesUpdate: "tax-categories:update",
  taxCategoriesDelete: "tax-categories:delete",
  suppliersList: "suppliers:list",
  suppliersCreate: "suppliers:create",
  suppliersUpdate: "suppliers:update",
  suppliersArchive: "suppliers:archive",
  suppliersRestore: "suppliers:restore",
  purchaseOrdersList: "purchase-orders:list",
  purchaseOrdersGet: "purchase-orders:get",
  purchaseOrdersCreate: "purchase-orders:create",
  purchaseOrdersUpdate: "purchase-orders:update",
  purchaseOrdersConfirm: "purchase-orders:confirm",
  purchaseOrdersCancel: "purchase-orders:cancel",
  purchaseOrdersSavePdf: "purchase-orders:save-pdf",
  purchaseOrdersPrint: "purchase-orders:print",
  goodsReceivedPost: "goods-received:post",
  shiftsState: "shifts:state",
  shiftsOpen: "shifts:open",
  shiftsAddCashMove: "shifts:add-cash-move",
  shiftsDeleteCashMove: "shifts:delete-cash-move",
  shiftsReport: "shifts:report",
  shiftsListDenominations: "shifts:list-denominations",
  shiftsClose: "shifts:close",
  checkoutCurrent: "checkout:current",
  checkoutScan: "checkout:scan",
  checkoutAddProduct: "checkout:add-product",
  checkoutAddMisc: "checkout:add-misc",
  checkoutUpdateLine: "checkout:update-line",
  checkoutDeleteLine: "checkout:delete-line",
  checkoutSetBillDiscount: "checkout:set-bill-discount",
  checkoutHold: "checkout:hold",
  checkoutResume: "checkout:resume",
  checkoutListHeld: "checkout:list-held",
  checkoutDiscard: "checkout:discard",
  checkoutComplete: "checkout:complete",
  checkoutToggleReturn: "checkout:toggle-return",
  checkoutSetDamaged: "checkout:set-damaged",
  returnsReturnable: "returns:returnable",
  returnsAddFromSale: "returns:add-from-sale",
  salesList: "sales:list",
  salesGet: "sales:get",
  auditList: "audit:list",
  auditUsers: "audit:users",
  backupStatus: "backup:status",
  backupRun: "backup:run",
  backupChooseFile: "backup:choose-file",
  backupRestore: "backup:restore",
  backupPasswordStatus: "backup:password-status",
  backupPasswordTurnOn: "backup:password-turn-on",
  backupPasswordChange: "backup:password-change",
  backupPasswordTurnOff: "backup:password-turn-off",
} as const;

export const ipcErrorMessages = {
  unauthenticated: "Log in to continue.",
} as const;

export interface VendoraApi {
  app: {
    getInfo: () => Promise<AppInfo>;
  };
  auth: {
    login: (username: string, password: string) => Promise<AuthResult>;
    switchByPin: (userId: string, pin: string) => Promise<AuthResult>;
    logout: () => Promise<void>;
    current: () => Promise<SessionState | null>;
    listLoginUsers: () => Promise<LoginUser[]>;
    needsSetup: () => Promise<boolean>;
    createFirstUser: (input: CreateFirstUserInput) => Promise<CreateFirstUserResult>;
  };
  settings: {
    setScalePrefixes: (input: ScalePrefixesInput) => Promise<ScalePrefixesSetting>;
    getMiscItemEnabled: () => Promise<MiscItemSetting>;
    setMiscItemEnabled: (enabled: boolean) => Promise<MiscItemSetting>;
    getShiftVarianceWarn: () => Promise<ShiftVarianceSetting>;
    setShiftVarianceWarn: (warnPaisa: number) => Promise<ShiftVarianceSetting>;
    getReceipt: () => Promise<ReceiptSettings>;
    setReceipt: (input: ReceiptSettingsInput) => Promise<ReceiptSettings>;
    getSecondCopy: () => Promise<SecondCopyStatus>;
    chooseSecondCopyFolder: () => Promise<SecondCopyStatus>;
    clearSecondCopyFolder: () => Promise<SecondCopyStatus>;
  };
  printer: {
    getSettings: () => Promise<PrinterSettings>;
    setSettings: (input: PrinterSettings) => Promise<PrinterSettings>;
    listWindows: () => Promise<WindowsPrinter[]>;
    status: () => Promise<PrinterStatus>;
    testPrint: () => Promise<PrintResult>;
    testDrawer: () => Promise<PrintResult>;
    openDrawerForCount: (phase: CountPhase) => Promise<OpenDrawerForCountResult>;
  };
  receipts: {
    saleJob: (saleId: string) => Promise<SaleJobResult>;
    print: (saleId: string) => Promise<PrintResult>;
    printShiftReport: (shiftId: string) => Promise<PrintResult>;
  };
  users: {
    list: () => Promise<ManagedUser[]>;
    create: (input: CreateUserInput) => Promise<CreateUserResult>;
    update: (input: UpdateUserInput) => Promise<UpdateUserResult>;
    resetPassword: (id: string, password: string) => Promise<UserActionResult>;
    resetPin: (id: string, pin: string) => Promise<UserActionResult>;
    deactivate: (id: string) => Promise<DeactivateUserResult>;
    reactivate: (id: string) => Promise<UserActionResult>;
  };
  inventory: {
    listStock: (query: StockListQuery) => Promise<StockListResult>;
    stockHistory: (query: StockHistoryQuery) => Promise<StockHistoryResult>;
    negativeStock: (query: NegativeStockQuery) => Promise<NegativeStockResult>;
    adjustStock: (input: StockAdjustmentInput) => Promise<StockAdjustmentResult>;
    lowStock: (query: LowStockQuery) => Promise<LowStockResult>;
  };
  stocktake: {
    current: () => Promise<StocktakeSummary | null>;
    start: (input: StartStocktakeInput) => Promise<StartStocktakeResult>;
    lines: (query: StocktakeLinesQuery) => Promise<StocktakeLinesResult>;
    scan: (input: StocktakeScanInput) => Promise<StocktakeScanResult>;
    record: (input: RecordCountInput) => Promise<RecordCountResult>;
    cancel: (stocktakeId: string) => Promise<CancelStocktakeResult>;
  };
  products: {
    getMiscItem: () => Promise<Product | null>;
    search: (input: ProductSearchQuery) => Promise<ProductSearchResult>;
    get: (id: string) => Promise<GetProductResult>;
    create: (input: CreateProductInput) => Promise<CreateProductResult>;
    update: (input: UpdateProductInput) => Promise<UpdateProductResult>;
    archive: (id: string) => Promise<ProductStatusResult>;
    restore: (id: string) => Promise<ProductStatusResult>;
    delete: (id: string) => Promise<DeleteProductResult>;
    bulkUpdate: (input: BulkUpdateProductsInput) => Promise<BulkUpdateProductsResult>;
    lookupBarcode: (barcode: string) => Promise<BarcodeLookup | null>;
    exportCsv: () => Promise<CatalogExportResult>;
  };
  categories: {
    list: () => Promise<Category[]>;
    create: (name: string) => Promise<CreateCategoryResult>;
    rename: (id: string, name: string) => Promise<RenameCategoryResult>;
    remove: (id: string) => Promise<DeleteCategoryResult>;
  };
  taxCategories: {
    list: () => Promise<TaxCategory[]>;
    create: (input: CreateTaxCategoryInput) => Promise<CreateTaxCategoryResult>;
    update: (input: UpdateTaxCategoryInput) => Promise<UpdateTaxCategoryResult>;
    remove: (id: string) => Promise<DeleteTaxCategoryResult>;
  };
  suppliers: {
    list: (input?: SupplierListInput) => Promise<Supplier[]>;
    create: (input: CreateSupplierInput) => Promise<CreateSupplierResult>;
    update: (input: UpdateSupplierInput) => Promise<UpdateSupplierResult>;
    archive: (id: string) => Promise<SupplierStatusResult>;
    restore: (id: string) => Promise<SupplierStatusResult>;
  };
  purchaseOrders: {
    list: () => Promise<PurchaseOrderSummary[]>;
    get: (id: string) => Promise<GetPurchaseOrderResult>;
    create: (input: CreatePurchaseOrderInput) => Promise<CreatePurchaseOrderResult>;
    update: (input: UpdatePurchaseOrderInput) => Promise<UpdatePurchaseOrderResult>;
    confirm: (id: string) => Promise<ConfirmPurchaseOrderResult>;
    cancel: (id: string) => Promise<CancelPurchaseOrderResult>;
    savePdf: (id: string) => Promise<SavePurchaseOrderPdfResult>;
    print: (id: string) => Promise<PrintPurchaseOrderResult>;
  };
  goodsReceived: {
    post: (input: PostGoodsReceivedInput) => Promise<PostGoodsReceivedResult>;
  };
  shifts: {
    state: () => Promise<ShiftState>;
    open: (openingFloatPaisa: number) => Promise<OpenShiftResult>;
    addCashMove: (input: AddCashMoveInput) => Promise<AddCashMoveResult>;
    deleteCashMove: (id: string) => Promise<DeleteCashMoveResult>;
    report: (id: string) => Promise<ShiftReportResult>;
    listDenominations: () => Promise<Denomination[]>;
    close: (input: CloseShiftInput) => Promise<CloseShiftResult>;
  };
  checkout: {
    current: () => Promise<CurrentBill>;
    scan: (input: ScanInput) => Promise<BillResult>;
    addProduct: (input: AddProductInput) => Promise<BillResult>;
    addMisc: (input: AddMiscInput) => Promise<BillResult>;
    updateLine: (input: UpdateLineInput) => Promise<BillResult>;
    deleteLine: (lineId: string) => Promise<BillResult>;
    toggleReturn: (lineId: string) => Promise<BillResult>;
    setDamaged: (input: SetDamagedInput) => Promise<BillResult>;
    setBillDiscount: (input: SetBillDiscountInput) => Promise<BillResult>;
    hold: (input: HoldInput) => Promise<ActionResult>;
    resume: (draftId: string) => Promise<BillResult>;
    listHeld: () => Promise<HeldBillSummary[]>;
    discard: (draftId: string) => Promise<ActionResult>;
    complete: (input: CompleteSaleInput) => Promise<CompleteSaleResult>;
  };
  returns: {
    returnable: (saleId: string) => Promise<ReturnableResult>;
    addFromSale: (input: AddFromSaleInput) => Promise<BillResult>;
  };
  sales: {
    list: (query: SalesListQuery) => Promise<OrderSummary[]>;
    get: (id: string) => Promise<GetOrderResult>;
  };
  audit: {
    list: (query: AuditListQuery) => Promise<AuditPage>;
    listUsers: () => Promise<AuditUser[]>;
  };
  backup: {
    status: () => Promise<BackupStatus>;
    run: () => Promise<BackupNowResult>;
    chooseFile: () => Promise<ChosenBackup>;
    restore: (input: RestoreInput) => Promise<RestoreResult>;
    passwordStatus: () => Promise<BackupPasswordStatus>;
    turnOnPassword: (password: string) => Promise<BackupPasswordResult>;
    changePassword: (current: string, next: string) => Promise<BackupPasswordResult>;
    turnOffPassword: (current: string) => Promise<BackupPasswordResult>;
  };
}
