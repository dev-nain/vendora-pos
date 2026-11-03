import { z } from "zod";
import type {
  ApprovalResult,
  AuthResult,
  CreateOwnerInput,
  CreateOwnerResult,
  LoginUser,
  SessionState,
} from "./auth";
import type { GatedAction } from "./gated-actions";
import type { AutoLockSetting, ScalePrefixesInput, ScalePrefixesSetting } from "./settings";
import type {
  CreateUserInput,
  CreateUserResult,
  DeactivateUserResult,
  ManagedUser,
  UpdateUserInput,
  UpdateUserResult,
  UserActionResult,
} from "./users";

export const appInfoSchema = z.object({ version: z.string() });

export type AppInfo = z.infer<typeof appInfoSchema>;

export const ipcChannels = {
  appGetInfo: "app:get-info",
  authLogin: "auth:login",
  authSwitchByPin: "auth:switch-by-pin",
  authApprove: "auth:approve",
  authLogout: "auth:logout",
  authLock: "auth:lock",
  authLocked: "auth:locked",
  authCurrent: "auth:current",
  authListLoginUsers: "auth:list-login-users",
  activityReport: "activity:report",
  settingsGetAutoLock: "settings:get-auto-lock",
  settingsSetAutoLock: "settings:set-auto-lock",
  settingsSetScalePrefixes: "settings:set-scale-prefixes",
  authNeedsOwnerSetup: "auth:needs-owner-setup",
  authCreateOwner: "auth:create-owner",
  usersList: "users:list",
  usersCreate: "users:create",
  usersUpdate: "users:update",
  usersResetPassword: "users:reset-password",
  usersResetPin: "users:reset-pin",
  usersDeactivate: "users:deactivate",
  usersReactivate: "users:reactivate",
} as const;

export const ipcErrorMessages = {
  unauthenticated: "Log in to continue.",
  locked: "Vendora is locked. Unlock to continue.",
  forbidden: "You don't have permission to do this. Ask the owner or a manager.",
  approvalInvalid: "Approval expired or was already used. Ask for approval again.",
} as const;

export interface VendoraApi {
  app: {
    getInfo: () => Promise<AppInfo>;
  };
  auth: {
    login: (username: string, password: string) => Promise<AuthResult>;
    switchByPin: (userId: string, pin: string) => Promise<AuthResult>;
    approve: (action: GatedAction, approverUserId: string, pin: string) => Promise<ApprovalResult>;
    logout: () => Promise<void>;
    lock: () => Promise<void>;
    onLocked: (listener: () => void) => () => void;
    current: () => Promise<SessionState | null>;
    listLoginUsers: () => Promise<LoginUser[]>;
    needsOwnerSetup: () => Promise<boolean>;
    createOwner: (input: CreateOwnerInput) => Promise<CreateOwnerResult>;
  };
  activity: {
    report: () => void;
  };
  settings: {
    getAutoLock: () => Promise<AutoLockSetting>;
    setAutoLock: (minutes: number | null) => Promise<AutoLockSetting>;
    setScalePrefixes: (input: ScalePrefixesInput) => Promise<ScalePrefixesSetting>;
  };
  users: {
    list: () => Promise<ManagedUser[]>;
    create: (input: CreateUserInput) => Promise<CreateUserResult>;
    update: (input: UpdateUserInput) => Promise<UpdateUserResult>;
    resetPassword: (id: string, password: string) => Promise<UserActionResult>;
    resetPin: (id: string, pin: string) => Promise<UserActionResult>;
    deactivate: (id: string) => Promise<DeactivateUserResult>;
    reactivate: (id: string) => Promise<UserActionResult>;
  };
}
