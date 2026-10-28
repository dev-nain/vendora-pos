import { z } from "zod";
import { contextBridge, ipcRenderer } from "electron";
import { authResultSchema, loginUserSchema, safeUserSchema } from "@shared/auth";
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
    logout: async () => {
      await ipcRenderer.invoke(ipcChannels.authLogout);
    },
    current: async () =>
      safeUserSchema.nullable().parse(await ipcRenderer.invoke(ipcChannels.authCurrent)),
    listLoginUsers: async () =>
      z.array(loginUserSchema).parse(await ipcRenderer.invoke(ipcChannels.authListLoginUsers)),
  },
};

contextBridge.exposeInMainWorld("vendora", api);
