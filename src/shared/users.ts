import { z } from "zod";
import { createFirstUserInputSchema, userRoleSchema } from "./auth";
import { passwordSchema, pinSchema } from "./credentials";

export const userMessages = {
  usernameTaken: "That username is already taken.",
  lastOwner: "Vendora needs at least one active Owner.",
  notFound: "That user no longer exists. Refresh the list.",
} as const;

const { username, displayName } = createFirstUserInputSchema.shape;

export const createUserInputSchema = z.strictObject({
  username,
  displayName,
  role: userRoleSchema,
  password: passwordSchema,
  pin: pinSchema,
});

export const updateUserInputSchema = z.strictObject({
  id: z.uuid(),
  displayName,
  role: userRoleSchema,
});

export const resetPasswordInputSchema = z.strictObject({
  id: z.uuid(),
  password: passwordSchema,
});

export const resetPinInputSchema = z.strictObject({
  id: z.uuid(),
  pin: pinSchema,
});

export const userIdInputSchema = z.strictObject({ id: z.uuid() });

export const managedUserSchema = z.strictObject({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  role: userRoleSchema,
  isActive: z.boolean(),
  pinLocked: z.boolean(),
});

const usernameTakenSchema = z.strictObject({
  ok: z.literal(false),
  reason: z.literal("username-taken"),
  message: z.string(),
});

const lastOwnerSchema = z.strictObject({
  ok: z.literal(false),
  reason: z.literal("last-owner"),
  message: z.string(),
});

const notFoundSchema = z.strictObject({
  ok: z.literal(false),
  reason: z.literal("not-found"),
  message: z.string(),
});

const sessionChangeResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), sessionEnded: z.boolean() }),
  lastOwnerSchema,
  notFoundSchema,
]);

export const createUserResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), user: managedUserSchema }),
  usernameTakenSchema,
]);

export const updateUserResultSchema = sessionChangeResultSchema;
export const deactivateUserResultSchema = sessionChangeResultSchema;

export const userActionResultSchema = z.union([
  z.strictObject({ ok: z.literal(true) }),
  notFoundSchema,
]);

export type ManagedUser = z.infer<typeof managedUserSchema>;
export type CreateUserInput = z.input<typeof createUserInputSchema>;
export type UpdateUserInput = z.input<typeof updateUserInputSchema>;
export type CreateUserResult = z.infer<typeof createUserResultSchema>;
export type UpdateUserResult = z.infer<typeof updateUserResultSchema>;
export type DeactivateUserResult = z.infer<typeof deactivateUserResultSchema>;
export type UserActionResult = z.infer<typeof userActionResultSchema>;
