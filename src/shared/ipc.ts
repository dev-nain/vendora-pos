import { z } from "zod";
import type { AuthResult, LoginUser, SessionState } from "./auth";
import type { AutoLockSetting } from "./settings";

export const appInfoSchema = z.object({ version: z.string() });

export type AppInfo = z.infer<typeof appInfoSchema>;

export const ipcChannels = {
  appGetInfo: "app:get-info",
  authLogin: "auth:login",
  authSwitchByPin: "auth:switch-by-pin",
  authLogout: "auth:logout",
  authLock: "auth:lock",
  authLocked: "auth:locked",
  authCurrent: "auth:current",
  authListLoginUsers: "auth:list-login-users",
  activityReport: "activity:report",
  settingsGetAutoLock: "settings:get-auto-lock",
  settingsSetAutoLock: "settings:set-auto-lock",
} as const;

export const ipcErrorMessages = {
  unauthenticated: "Log in to continue.",
  locked: "Vendora is locked. Unlock to continue.",
  forbidden: "You don't have permission to do this. Ask the owner or a manager.",
} as const;

export interface VendoraApi {
  app: {
    getInfo: () => Promise<AppInfo>;
  };
  auth: {
    login: (username: string, password: string) => Promise<AuthResult>;
    switchByPin: (userId: string, pin: string) => Promise<AuthResult>;
    logout: () => Promise<void>;
    lock: () => Promise<void>;
    onLocked: (listener: () => void) => () => void;
    current: () => Promise<SessionState | null>;
    listLoginUsers: () => Promise<LoginUser[]>;
  };
  activity: {
    report: () => void;
  };
  settings: {
    getAutoLock: () => Promise<AutoLockSetting>;
    setAutoLock: (minutes: number | null) => Promise<AutoLockSetting>;
  };
}
