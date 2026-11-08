import { z } from "zod";

export const backupKinds = ["backup", "before-restore", "before-update"] as const;
export type BackupKind = (typeof backupKinds)[number];

export const backupFileNameSchema = z
  .string()
  .regex(/^(vendora|pre-restore|pre-migrate)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db$/);

export const backupFileSchema = z.strictObject({
  fileName: backupFileNameSchema,
  kind: z.enum(backupKinds),
  takenAt: z.iso.datetime(),
  sizeBytes: z.int().nonnegative(),
  encrypted: z.boolean(),
});
export type BackupFile = z.infer<typeof backupFileSchema>;

export const backupStatusSchema = z.strictObject({
  lastBackupAt: z.iso.datetime().nullable(),
  lastFailure: z.strictObject({ at: z.iso.datetime(), reason: z.string() }).nullable(),
  backups: z.array(backupFileSchema),
  restoreBlock: z.string().nullable(),
});
export type BackupStatus = z.infer<typeof backupStatusSchema>;

export const backupNowResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type BackupNowResult = z.infer<typeof backupNowResultSchema>;

export const chosenBackupSchema = z
  .strictObject({
    token: z.uuid(),
    fileName: z.string(),
    takenAt: z.iso.datetime(),
    encrypted: z.boolean(),
  })
  .nullable();
export type ChosenBackup = z.infer<typeof chosenBackupSchema>;

export const restorePasswordSchema = z.string().min(1).max(256);

export const restoreInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("listed"),
    fileName: backupFileNameSchema,
    password: restorePasswordSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("picked"),
    token: z.uuid(),
    password: restorePasswordSchema.optional(),
  }),
]);
export type RestoreInput = z.infer<typeof restoreInputSchema>;

export const restoreRefusals = [
  "open-work",
  "not-found",
  "not-vendora",
  "corrupt",
  "newer-version",
  "migration-failed",
  "backup-failed",
  "swap-failed",
  "set-aside-failed",
  "password-required",
  "wrong-password",
] as const;
export type RestoreRefusal = (typeof restoreRefusals)[number];

export const restoreResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), reason: z.enum(restoreRefusals), message: z.string() }),
]);
export type RestoreResult = z.infer<typeof restoreResultSchema>;

export const backupPasswordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(256, "Use 256 characters or fewer.");

export const turnOnBackupPasswordInputSchema = z.strictObject({ password: backupPasswordSchema });
export type TurnOnBackupPasswordInput = z.infer<typeof turnOnBackupPasswordInputSchema>;

export const changeBackupPasswordInputSchema = z.strictObject({
  current: restorePasswordSchema,
  next: backupPasswordSchema,
});
export type ChangeBackupPasswordInput = z.infer<typeof changeBackupPasswordInputSchema>;

export const turnOffBackupPasswordInputSchema = z.strictObject({ current: restorePasswordSchema });
export type TurnOffBackupPasswordInput = z.infer<typeof turnOffBackupPasswordInputSchema>;

export const backupPasswordStatusSchema = z.strictObject({
  state: z.enum(["off", "on", "unreadable"]),
});
export type BackupPasswordStatus = z.infer<typeof backupPasswordStatusSchema>;

export const backupPasswordResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), status: backupPasswordStatusSchema }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum(["wrong-password", "protection-unavailable", "already-on", "already-off"]),
    message: z.string(),
  }),
]);
export type BackupPasswordResult = z.infer<typeof backupPasswordResultSchema>;
