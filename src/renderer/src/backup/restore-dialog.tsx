import { useRef, useState, type FormEvent, type RefObject } from "react";

import type { RestoreInput, RestoreRefusal, RestoreResult } from "@shared/backup";
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
import { formatDateTime } from "@renderer/lib/date-time";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { ErrorLine } from "../users/form-parts";

export interface RestoreTarget {
  input: RestoreInput;
  takenAt: string;
  pickedFileName: string | null;
  encrypted: boolean;
}

interface RestoreDialogProps {
  target: RestoreTarget;
  open: boolean;
  finalFocus: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  restore: (input: RestoreInput) => Promise<RestoreResult>;
  description: string;
  retryable?: ReadonlySet<RestoreRefusal>;
  onRefused: () => void;
  onSessionEnded?: (() => void) | undefined;
}

export const defaultRetryable: ReadonlySet<RestoreRefusal> = new Set([
  "backup-failed",
  "wrong-password",
  "password-required",
]);

interface Refusal {
  reason: RestoreRefusal;
  message: string;
}

function RestoreForm({
  target,
  restore,
  description,
  retryable,
  onClose,
  onRefused,
  onSessionEnded,
  onPendingChange,
}: Pick<
  RestoreDialogProps,
  "target" | "restore" | "description" | "onRefused" | "onSessionEnded"
> & {
  retryable: ReadonlySet<RestoreRefusal>;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const passwordInput = useRef<HTMLInputElement | null>(null);

  const focusPassword = () => requestAnimationFrame(() => passwordInput.current?.focus());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    if (target.encrypted && password === "") {
      setPasswordError("Enter the password.");
      focusPassword();
      return;
    }

    setRefusal(null);
    setFailure(null);
    setPasswordError(null);
    setPending(true);
    onPendingChange(true);
    const sent = password;
    setPassword("");
    try {
      const result = await restore(
        target.encrypted ? { ...target.input, password: sent } : target.input,
      );
      if (result.ok) return;
      setRefusal({ reason: result.reason, message: result.message });
      if (retryable.has(result.reason)) focusPassword();
      else if (result.reason !== "backup-failed") onRefused();
    } catch (cause) {
      if (onSessionEnded && isSessionError(cause)) {
        onSessionEnded();
        return;
      }
      setFailure(serviceErrorMessage);
    }
    setPending(false);
    onPendingChange(false);
  };

  const canRetry = refusal === null || retryable.has(refusal.reason);
  const message = refusal?.message ?? failure;

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Restore backup from {formatDateTime(target.takenAt)}?</DialogTitle>
        <DialogDescription>
          {description}
          {target.encrypted
            ? " This backup has a password. Enter the password it was made with."
            : ""}
        </DialogDescription>
        {target.pickedFileName ? (
          <p className="m-0 text-[length:var(--font-size-350)] break-all text-foreground">
            {target.pickedFileName}
          </p>
        ) : null}
        {target.encrypted ? (
          <Field invalid={Boolean(passwordError)}>
            <FieldLabel>Backup password</FieldLabel>
            <Input
              ref={passwordInput}
              type="password"
              autoComplete="off"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {passwordError ? <FieldError>{passwordError}</FieldError> : null}
          </Field>
        ) : null}
        {message ? <ErrorLine>{message}</ErrorLine> : null}
        {pending ? (
          <p role="status" className="m-0 text-[length:var(--font-size-350)] text-secondary">
            Restoring. Vendora will restart when it's done.
          </p>
        ) : null}
      </DialogHeader>
      <DialogFooter>
        {pending ? null : (
          <Button type="button" variant="secondary" autoFocus={!target.encrypted} onClick={onClose}>
            {refusal ? "Close" : "Cancel"}
          </Button>
        )}
        {canRetry ? (
          <Button type="submit" variant="destructive" disabled={pending}>
            {pending ? "Restoring…" : "Restore"}
          </Button>
        ) : null}
      </DialogFooter>
    </form>
  );
}

export function RestoreDialog({
  target,
  open,
  finalFocus,
  onOpenChange,
  restore,
  description,
  retryable = defaultRetryable,
  onRefused,
  onSessionEnded,
}: RestoreDialogProps) {
  const [pending, setPending] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent finalFocus={finalFocus}>
        <RestoreForm
          target={target}
          restore={restore}
          description={description}
          retryable={retryable}
          onClose={() => onOpenChange(false)}
          onRefused={onRefused}
          onSessionEnded={onSessionEnded}
          onPendingChange={setPending}
        />
      </DialogContent>
    </Dialog>
  );
}
