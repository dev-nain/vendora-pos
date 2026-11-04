import { z } from "zod";
import type {
  AuthResult,
  CreateOwnerInput,
  CreateOwnerResult,
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
  AutoLockSetting,
  MiscItemSetting,
  ScalePrefixesInput,
  ScalePrefixesSetting,
} from "./settings";
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
  authLock: "auth:lock",
  authLocked: "auth:locked",
  authCurrent: "auth:current",
  authListLoginUsers: "auth:list-login-users",
  activityReport: "activity:report",
  settingsGetAutoLock: "settings:get-auto-lock",
  settingsSetAutoLock: "settings:set-auto-lock",
  settingsSetScalePrefixes: "settings:set-scale-prefixes",
  settingsGetMiscItemEnabled: "settings:get-misc-item-enabled",
  settingsSetMiscItemEnabled: "settings:set-misc-item-enabled",
  authNeedsOwnerSetup: "auth:needs-owner-setup",
  authCreateOwner: "auth:create-owner",
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
} as const;

export const ipcErrorMessages = {
  unauthenticated: "Log in to continue.",
  locked: "Vendora is locked. Unlock to continue.",
  forbidden: "You don't have permission to do this. Ask the owner or a manager.",
} as const;

export interface VendoraApi {
  app: {
    getInfo: () => Promise<AppInfo>;
  };
  auth: {
    login: (username: string, password: string) => Promise<AuthResult>;
    switchByPin: (userId: string, pin: string) => Promise<AuthResult>;
    logout: () => Promise<void>;
    lock: () => Promise<void>;
    onLocked: (listener: () => void) => () => void;
    current: () => Promise<SessionState | null>;
    listLoginUsers: () => Promise<LoginUser[]>;
    needsOwnerSetup: () => Promise<boolean>;
    createOwner: (input: CreateOwnerInput) => Promise<CreateOwnerResult>;
  };
  activity: {
    report: () => void;
  };
  settings: {
    getAutoLock: () => Promise<AutoLockSetting>;
    setAutoLock: (minutes: number | null) => Promise<AutoLockSetting>;
    setScalePrefixes: (input: ScalePrefixesInput) => Promise<ScalePrefixesSetting>;
    getMiscItemEnabled: () => Promise<MiscItemSetting>;
    setMiscItemEnabled: (enabled: boolean) => Promise<MiscItemSetting>;
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
}
