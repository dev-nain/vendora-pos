import { contextBridge, ipcRenderer } from "electron";
import { appInfoSchema, ipcChannels, type VendoraApi } from "@shared/ipc";

const api: VendoraApi = {
  app: {
    getInfo: async () => appInfoSchema.parse(await ipcRenderer.invoke(ipcChannels.appGetInfo)),
  },
};

contextBridge.exposeInMainWorld("vendora", api);
