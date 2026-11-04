import { z } from "zod";
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
import type {
  MiscItemSetting,
  ScalePrefixesInput,
  ScalePrefixesSetting,
  ShiftVarianceSetting,
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
  ShiftState,
} from "./shifts";
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
  authNeedsSetup: "auth:needs-setup",
  authCreateFirstUser: "auth:create-first-user",
  usersList: "users:list",
  usersCreate: "users:create",
  usersUpdate: "users:update",
  usersResetPassword: "users:reset-password",
  usersResetPin: "users:reset-pin",
  usersDeactivate: "users:deactivate",
  usersReactivate: "users:reactivate",
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
  shiftsState: "shifts:state",
  shiftsOpen: "shifts:open",
  shiftsAddCashMove: "shifts:add-cash-move",
  shiftsDeleteCashMove: "shifts:delete-cash-move",
  shiftsReport: "shifts:report",
  shiftsListDenominations: "shifts:list-denominations",
  shiftsClose: "shifts:close",
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
  shifts: {
    state: () => Promise<ShiftState>;
    open: (openingFloatPaisa: number) => Promise<OpenShiftResult>;
    addCashMove: (input: AddCashMoveInput) => Promise<AddCashMoveResult>;
    deleteCashMove: (id: string) => Promise<DeleteCashMoveResult>;
    report: (id: string) => Promise<ShiftReportResult>;
    listDenominations: () => Promise<Denomination[]>;
    close: (input: CloseShiftInput) => Promise<CloseShiftResult>;
  };
}
