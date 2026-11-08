import { z } from "zod";
import { backupFileNameSchema, backupKinds } from "./backup";

export const startupStateSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("normal") }),
  z.strictObject({ mode: z.literal("damaged") }),
  z.strictObject({
    mode: z.literal("open-failed"),
    failure: z.enum(["in-use", "access-denied", "unreadable"]),
  }),
  z.strictObject({ mode: z.literal("newer-version") }),
  z.strictObject({ mode: z.literal("migration-failed") }),
]);
export type StartupState = z.infer<typeof startupStateSchema>;

export const recoveryBackupStatuses = [
  "good",
  "password-protected",
  "corrupt",
  "not-vendora",
  "newer-version",
] as const;
export type RecoveryBackupStatus = (typeof recoveryBackupStatuses)[number];

export const recoveryBackupSchema = z.strictObject({
  fileName: backupFileNameSchema,
  kind: z.enum(backupKinds),
  takenAt: z.iso.datetime(),
  status: z.enum(recoveryBackupStatuses),
});
export type RecoveryBackup = z.infer<typeof recoveryBackupSchema>;

export const recoveryScanSchema = z.strictObject({
  backups: z.array(recoveryBackupSchema),
  lastGood: backupFileNameSchema.nullable(),
});
export type RecoveryScan = z.infer<typeof recoveryScanSchema>;
