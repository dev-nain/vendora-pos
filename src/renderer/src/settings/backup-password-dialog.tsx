import { useRef, useState, type FormEvent, type RefObject } from "react";

import type { BackupPasswordResult, BackupPasswordStatus } from "@shared/backup";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { ErrorLine } from "../users/form-parts";
import {
  validateBackupPasswordForm,
  type BackupPasswordFormErrors,
  type BackupPasswordFormField,
  type BackupPasswordMode,
} from "./backup-password-form";

interface BackupPasswordDialogProps {
  mode: BackupPasswordMode;
  open: boolean;
  finalFocus: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  onChanged: (status: BackupPasswordStatus, message: string) => void;
  onSessionEnded: () => void;
}

const copy = {
  "turn-on": {
    title: "Turn on backup password",
    action: "Turn on",
    pending: "Turning on…",
    done: "Backup password is on.",
    description:
      "If you lose this password, no one can recover it, and backups made with it can't be restored. Backups already made stay unencrypted until they're removed after 30 days. Backups made before an app update stay on this PC and aren't encrypted.",
  },
  change: {
    title: "Change backup password",
    action: "Change password",
    pending: "Changing…",
    done: "Backup password changed.",
    description:
      "Backups already made keep their old password. Keep it until those backups are gone. If you lose the new password, no one can recover it.",
  },
  "turn-off": {
    title: "Turn off backup password",
    action: "Turn off",
    pending: "Turning off…",
    done: "Backup password is off.",
    description: "New backups won't be encrypted. Backups already made still need their password.",
  },
} as const;

const fieldLabels: Record<BackupPasswordFormField, string> = {
  current: "Current password",
  next: "New password",
  confirm: "Confirm password",
};

const fieldsByMode: Record<BackupPasswordMode, readonly BackupPasswordFormField[]> = {
  "turn-on": ["next", "confirm"],
  change: ["current", "next", "confirm"],
  "turn-off": ["current"],
};

function send(
  mode: BackupPasswordMode,
  values: Record<BackupPasswordFormField, string>,
): Promise<BackupPasswordResult> {
  if (mode === "turn-on") return window.vendora.backup.turnOnPassword(values.next);
  if (mode === "change") return window.vendora.backup.changePassword(values.current, values.next);
  return window.vendora.backup.turnOffPassword(values.current);
}

function BackupPasswordForm({
  mode,
  onClose,
  onChanged,
  onSessionEnded,
  onPendingChange,
}: Pick<BackupPasswordDialogProps, "mode" | "onChanged" | "onSessionEnded"> & {
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const text = copy[mode];
  const fields = fieldsByMode[mode];
  const [values, setValues] = useState({ current: "", next: "", confirm: "" });
  const [errors, setErrors] = useState<BackupPasswordFormErrors>({});
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputs = useRef<Partial<Record<BackupPasswordFormField, HTMLInputElement | null>>>({});

  const focus = (field: BackupPasswordFormField | undefined) =>
    requestAnimationFrame(() => (field ? inputs.current[field] : undefined)?.focus());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    const found = validateBackupPasswordForm(mode, values);
    const invalid = fields.find((field) => found[field]);
    if (invalid) {
      setErrors(found);
      setServiceError(null);
      focus(invalid);
      return;
    }

    setErrors({});
    setServiceError(null);
    setPending(true);
    onPendingChange(true);
    const sent = values;
    setValues({ current: "", next: "", confirm: "" });
    try {
      const result = await send(mode, sent);
      if (result.ok) {
        onPendingChange(false);
        onChanged(result.status, text.done);
        onClose();
        return;
      }
      setServiceError(result.message);
      focus(result.reason === "wrong-password" ? "current" : fields[0]);
    } catch (cause) {
      if (isSessionError(cause)) {
        onSessionEnded();
        return;
      }
      setServiceError(serviceErrorMessage);
      focus(fields[0]);
    }
    setPending(false);
    onPendingChange(false);
  };

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>{text.title}</DialogTitle>
        <DialogDescription>{text.description}</DialogDescription>
        <div className="grid gap-400">
          {fields.map((field, index) => (
            <Field key={field} invalid={Boolean(errors[field])}>
              <FieldLabel>{fieldLabels[field]}</FieldLabel>
              <Input
                ref={(node) => {
                  inputs.current[field] = node;
                }}
                type="password"
                autoComplete={field === "current" ? "current-password" : "new-password"}
                autoFocus={index === 0}
                value={values[field]}
                onChange={(event) => setValues({ ...values, [field]: event.target.value })}
              />
              {errors[field] ? <FieldError>{errors[field]}</FieldError> : null}
            </Field>
          ))}
        </div>
        {serviceError ? <ErrorLine>{serviceError}</ErrorLine> : null}
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? text.pending : text.action}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function BackupPasswordDialog({
  mode,
  open,
  finalFocus,
  onOpenChange,
  onChanged,
  onSessionEnded,
}: BackupPasswordDialogProps) {
  const [pending, setPending] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent finalFocus={finalFocus}>
        <BackupPasswordForm
          mode={mode}
          onClose={() => onOpenChange(false)}
          onChanged={onChanged}
          onSessionEnded={onSessionEnded}
          onPendingChange={setPending}
        />
      </DialogContent>
    </Dialog>
  );
}
