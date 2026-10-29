import { z } from "zod";
import { contextBridge, ipcRenderer } from "electron";
import {
  approvalResultSchema,
  authResultSchema,
  createOwnerResultSchema,
  loginUserSchema,
  safeUserSchema,
} from "@shared/auth";
import { appInfoSchema, ipcChannels, type VendoraApi } from "@shared/ipc";
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
    current: async () =>
      safeUserSchema.nullable().parse(await ipcRenderer.invoke(ipcChannels.authCurrent)),
    listLoginUsers: async () =>
      z.array(loginUserSchema).parse(await ipcRenderer.invoke(ipcChannels.authListLoginUsers)),
    needsOwnerSetup: async () =>
      z.boolean().parse(await ipcRenderer.invoke(ipcChannels.authNeedsOwnerSetup)),
    createOwner: async (input) =>
      createOwnerResultSchema.parse(await ipcRenderer.invoke(ipcChannels.authCreateOwner, input)),
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
};

contextBridge.exposeInMainWorld("vendora", api);
