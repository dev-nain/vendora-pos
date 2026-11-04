import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
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
import { appInfoSchema, ipcChannels } from "@shared/ipc";
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
  miscItemInputSchema,
  miscItemSettingSchema,
  scalePrefixesInputSchema,
  scalePrefixesSettingSchema,
} from "@shared/settings";
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
import type { AuthService } from "./services/auth";
import type { CatalogExportService } from "./services/catalog-export";
import type { CategoriesService } from "./services/categories";
import type { ProductsService } from "./services/products";
import type { SettingsService } from "./services/settings";
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

interface IpcServices {
  auth: AuthService;
  catalogExport: CatalogExportService;
  categories: CategoriesService;
  settings: SettingsService;
  taxCategories: TaxCategoriesService;
  users: UsersService;
  products: ProductsService;
}

export function registerIpcHandlers({
  auth,
  catalogExport,
  categories,
  products,
  settings,
  taxCategories,
  users,
}: IpcServices): void {
  handle(ipcChannels.appGetInfo, () => appInfoSchema.parse({ version: app.getVersion() }));
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
}
