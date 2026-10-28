import { z } from "zod";
import { gatedActions } from "./gated-actions";

export const userRoleSchema = z.enum(["owner", "manager", "cashier"]);

export const authMessages = {
  invalidCredentials: "Username or password is incorrect",
  invalidPin: "PIN is incorrect",
  notAllowedToApprove: "Only a manager or the owner can approve this.",
} as const;

export const loginInputSchema = z.strictObject({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

export const pinSwitchInputSchema = z.strictObject({
  userId: z.uuid(),
  pin: z.string().min(1).max(64),
});

export const approveInputSchema = z.strictObject({
  action: z.enum(gatedActions),
  approverUserId: z.uuid(),
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

export const approvalRefusalSchema = z.discriminatedUnion("reason", [
  z.strictObject({ ok: z.literal(false), reason: z.literal("invalid-pin"), message: z.string() }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.literal("pin-locked"),
    message: z.string(),
    retryAfterMs: z.number().int().positive(),
  }),
  z.strictObject({ ok: z.literal(false), reason: z.literal("not-allowed"), message: z.string() }),
]);

export const approvalResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), token: z.string().min(1).max(128) }),
  approvalRefusalSchema,
]);

export type SafeUser = z.infer<typeof safeUserSchema>;
export type LoginUser = z.infer<typeof loginUserSchema>;
export type AuthResult = z.infer<typeof authResultSchema>;
export type ApprovalResult = z.infer<typeof approvalResultSchema>;
