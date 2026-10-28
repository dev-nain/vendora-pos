import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import { appInfoSchema, ipcChannels } from "@shared/ipc";
import { toIpcError } from "./ipc-errors";

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

export function registerIpcHandlers(): void {
  handle(ipcChannels.appGetInfo, () => appInfoSchema.parse({ version: app.getVersion() }));
}
