import { app, ipcMain } from "electron";
import { appInfoSchema, ipcChannels } from "@shared/ipc";

export function registerIpcHandlers(): void {
  ipcMain.handle(ipcChannels.appGetInfo, () => appInfoSchema.parse({ version: app.getVersion() }));
}
