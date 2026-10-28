import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  authResultSchema,
  loginInputSchema,
  loginUserSchema,
  pinSwitchInputSchema,
  safeUserSchema,
} from "@shared/auth";
import { appInfoSchema, ipcChannels } from "@shared/ipc";
import { z } from "zod";
import { toIpcError } from "./ipc-errors";
import type { AuthService } from "./services/auth";

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

export function registerIpcHandlers({ auth }: { auth: AuthService }): void {
  handle(ipcChannels.appGetInfo, () => appInfoSchema.parse({ version: app.getVersion() }));
  handle(ipcChannels.authLogin, async (_event, input) =>
    authResultSchema.parse(await auth.login(loginInputSchema.parse(input))),
  );
  handle(ipcChannels.authSwitchByPin, async (_event, input) =>
    authResultSchema.parse(await auth.switchByPin(pinSwitchInputSchema.parse(input))),
  );
  handle(ipcChannels.authLogout, () => auth.logout());
  handle(ipcChannels.authCurrent, () => safeUserSchema.nullable().parse(auth.current()));
  handle(ipcChannels.authListLoginUsers, () =>
    z.array(loginUserSchema).parse(auth.listLoginUsers()),
  );
}
