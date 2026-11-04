import { z } from "zod";
import { passwordSchema, pinSchema } from "./credentials";

export const userRoleSchema = z.enum(["owner", "manager", "cashier"]);

export const authMessages = {
  invalidCredentials: "Username or password is incorrect",
  invalidPin: "PIN is incorrect",
  accountExists: "An account already exists. Log in instead.",
} as const;

export const loginInputSchema = z.strictObject({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

export const createFirstUserInputSchema = z.strictObject({
  username: z
    .string()
    .trim()
    .min(1, "Enter a username")
    .max(64, "Username must be 64 characters or fewer"),
  displayName: z
    .string()
    .trim()
    .min(1, "Enter a display name")
    .max(64, "Display name must be 64 characters or fewer"),
  password: passwordSchema,
  pin: pinSchema,
});

export const pinSwitchInputSchema = z.strictObject({
  userId: z.uuid(),
  pin: z.string().min(1).max(64),
});

export const safeUserSchema = z.strictObject({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  role: userRoleSchema,
});

export const loginUserSchema = z.strictObject({
  id: z.string(),
  displayName: z.string(),
  role: userRoleSchema,
});

export const authRefusalSchema = z.discriminatedUnion("reason", [
  z.strictObject({
    ok: z.literal(false),
    reason: z.literal("invalid-credentials"),
    message: z.string(),
  }),
  z.strictObject({ ok: z.literal(false), reason: z.literal("invalid-pin"), message: z.string() }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.literal("pin-locked"),
    message: z.string(),
    retryAfterMs: z.number().int().positive(),
  }),
]);

export const authResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), user: safeUserSchema }),
  authRefusalSchema,
]);

export const sessionStateSchema = z.strictObject({ user: safeUserSchema });

export const createFirstUserResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), user: safeUserSchema }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.literal("account-exists"),
    message: z.string(),
  }),
]);

export type SafeUser = z.infer<typeof safeUserSchema>;
export type SessionState = z.infer<typeof sessionStateSchema>;
export type LoginUser = z.infer<typeof loginUserSchema>;
export type AuthResult = z.infer<typeof authResultSchema>;
export type CreateFirstUserInput = z.input<typeof createFirstUserInputSchema>;
export type CreateFirstUserResult = z.infer<typeof createFirstUserResultSchema>;
