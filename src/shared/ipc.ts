import { z } from "zod";
import type { AuthResult, CreateOwnerInput, CreateOwnerResult, LoginUser, SafeUser } from "./auth";

export const appInfoSchema = z.object({ version: z.string() });

export type AppInfo = z.infer<typeof appInfoSchema>;

export const ipcChannels = {
  appGetInfo: "app:get-info",
  authLogin: "auth:login",
  authSwitchByPin: "auth:switch-by-pin",
  authLogout: "auth:logout",
  authCurrent: "auth:current",
  authListLoginUsers: "auth:list-login-users",
  authNeedsOwnerSetup: "auth:needs-owner-setup",
  authCreateOwner: "auth:create-owner",
} as const;

export const ipcErrorMessages = {
  unauthenticated: "Log in to continue.",
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
    current: () => Promise<SafeUser | null>;
    listLoginUsers: () => Promise<LoginUser[]>;
    needsOwnerSetup: () => Promise<boolean>;
    createOwner: (input: CreateOwnerInput) => Promise<CreateOwnerResult>;
  };
}
