import { z } from "zod";
import { contextBridge, ipcRenderer } from "electron";
import {
  approvalResultSchema,
  authResultSchema,
  createOwnerResultSchema,
  loginUserSchema,
  sessionStateSchema,
} from "@shared/auth";
import { autoLockSettingSchema, scalePrefixesSettingSchema } from "@shared/settings";
import { appInfoSchema, ipcChannels, type VendoraApi } from "@shared/ipc";
import {
  barcodeLookupSchema,
  bulkUpdateProductsResultSchema,
  createProductResultSchema,
  deleteProductResultSchema,
  getProductResultSchema,
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
    approve: async (action, approverUserId, pin) =>
      approvalResultSchema.parse(
        await ipcRenderer.invoke(ipcChannels.authApprove, { action, approverUserId, pin }),
      ),
    logout: async () => {
      await ipcRenderer.invoke(ipcChannels.authLogout);
    },
    lock: async () => {
      await ipcRenderer.invoke(ipcChannels.authLock);
    },
    onLocked: (listener) => {
      const handler = () => listener();
      ipcRenderer.on(ipcChannels.authLocked, handler);
      return () => {
        ipcRenderer.removeListener(ipcChannels.authLocked, handler);
      };
    },
    current: async () =>
      sessionStateSchema.nullable().parse(await ipcRenderer.invoke(ipcChannels.authCurrent)),
    listLoginUsers: async () =>
      z.array(loginUserSchema).parse(await ipcRenderer.invoke(ipcChannels.authListLoginUsers)),
    needsOwnerSetup: async () =>
      z.boolean().parse(await ipcRenderer.invoke(ipcChannels.authNeedsOwnerSetup)),
    createOwner: async (input) =>
      createOwnerResultSchema.parse(await ipcRenderer.invoke(ipcChannels.authCreateOwner, input)),
  },
  activity: {
    report: () => ipcRenderer.send(ipcChannels.activityReport),
  },
  settings: {
    getAutoLock: async () =>
      autoLockSettingSchema.parse(await ipcRenderer.invoke(ipcChannels.settingsGetAutoLock)),
    setAutoLock: async (minutes) =>
      autoLockSettingSchema.parse(
        await ipcRenderer.invoke(ipcChannels.settingsSetAutoLock, { minutes }),
      ),
    setScalePrefixes: async (input) =>
      scalePrefixesSettingSchema.parse(
        await ipcRenderer.invoke(ipcChannels.settingsSetScalePrefixes, input),
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
  products: {
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
};

contextBridge.exposeInMainWorld("vendora", api);
