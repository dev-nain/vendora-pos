import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  approvalResultSchema,
  approveInputSchema,
  authResultSchema,
  createOwnerInputSchema,
  createOwnerResultSchema,
  loginInputSchema,
  loginUserSchema,
  pinSwitchInputSchema,
  sessionStateSchema,
} from "@shared/auth";
import { appInfoSchema, ipcChannels } from "@shared/ipc";
import { autoLockInputSchema, autoLockSettingSchema } from "@shared/settings";
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
import type { AutoLock } from "./services/auto-lock";
import type { SettingsService } from "./services/settings";
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
  autoLock: AutoLock;
  settings: SettingsService;
  users: UsersService;
}

export function registerIpcHandlers({ auth, autoLock, settings, users }: IpcServices): void {
  handle(ipcChannels.appGetInfo, () => appInfoSchema.parse({ version: app.getVersion() }));
  handle(ipcChannels.authLogin, async (_event, input) =>
    authResultSchema.parse(await auth.login(loginInputSchema.parse(input))),
  );
  handle(ipcChannels.authSwitchByPin, async (_event, input) =>
    authResultSchema.parse(await auth.switchByPin(pinSwitchInputSchema.parse(input))),
  );
  handle(ipcChannels.authApprove, async (_event, input) =>
    approvalResultSchema.parse(await auth.approve(approveInputSchema.parse(input))),
  );
  handle(ipcChannels.authLogout, () => auth.logout());
  handle(ipcChannels.authLock, () => auth.lock());
  handle(ipcChannels.authCurrent, () => sessionStateSchema.nullable().parse(auth.current()));
  handle(ipcChannels.authListLoginUsers, () =>
    z.array(loginUserSchema).parse(auth.listLoginUsers()),
  );
  ipcMain.on(ipcChannels.activityReport, () => autoLock.reportActivity());
  handle(ipcChannels.settingsGetAutoLock, () =>
    autoLockSettingSchema.parse(settings.getAutoLock()),
  );
  handle(ipcChannels.settingsSetAutoLock, (_event, input) =>
    autoLockSettingSchema.parse(settings.setAutoLock(autoLockInputSchema.parse(input))),
  );
  handle(ipcChannels.authNeedsOwnerSetup, () => z.boolean().parse(auth.needsOwnerSetup()));
  handle(ipcChannels.authCreateOwner, async (_event, input) =>
    createOwnerResultSchema.parse(await auth.createOwner(createOwnerInputSchema.parse(input))),
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
}
