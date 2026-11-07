import { backupPasswordSchema } from "../../../shared/backup";

export type BackupPasswordMode = "turn-on" | "change" | "turn-off";

export interface BackupPasswordFormValues {
  current: string;
  next: string;
  confirm: string;
}

export type BackupPasswordFormField = keyof BackupPasswordFormValues;
export type BackupPasswordFormErrors = Partial<Record<BackupPasswordFormField, string>>;

export function validateBackupPasswordForm(
  mode: BackupPasswordMode,
  values: BackupPasswordFormValues,
): BackupPasswordFormErrors {
  const errors: BackupPasswordFormErrors = {};
  if (mode !== "turn-on" && values.current === "") errors.current = "Enter the current password.";
  if (mode === "turn-off") return errors;

  const parsed = backupPasswordSchema.safeParse(values.next);
  if (!parsed.success) errors.next = parsed.error.issues[0]?.message ?? "Enter a password.";
  else if (values.confirm !== values.next) errors.confirm = "Passwords don't match.";
  return errors;
}
