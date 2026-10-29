import { z } from "zod";
import { contextBridge, ipcRenderer } from "electron";
import {
  approvalResultSchema,
  authResultSchema,
  createOwnerResultSchema,
  loginUserSchema,
  sessionStateSchema,
} from "@shared/auth";
import { autoLockSettingSchema } from "@shared/settings";
import { appInfoSchema, ipcChannels, type VendoraApi } from "@shared/ipc";

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
  },
};

contextBridge.exposeInMainWorld("vendora", api);
