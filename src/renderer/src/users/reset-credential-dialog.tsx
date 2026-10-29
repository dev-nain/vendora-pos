import { useRef, useState, type FormEvent } from "react";

import type { ManagedUser } from "@shared/users";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { sanitizePin } from "../auth/pin-entry";
import { ErrorLine } from "./form-parts";
import {
  validateCredentialForm,
  type CredentialFormErrors,
  type CredentialKind,
} from "./user-form";

interface ResetCredentialDialogProps {
  kind: CredentialKind;
  user: ManagedUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onSessionEnded: () => void;
}

const copy = {
  password: {
    title: "Reset password",
    label: "New password",
    confirmLabel: "Confirm new password",
    hint: "4–5 characters",
    action: "Reset password",
    pending: "Resetting password…",
  },
  pin: {
    title: "Reset PIN",
    label: "New PIN",
    confirmLabel: "Confirm new PIN",
    hint: "4–6 digits",
    action: "Reset PIN",
    pending: "Resetting PIN…",
  },
} as const;

function ResetCredentialForm({
  kind,
  user,
  onClose,
  onSaved,
  onSessionEnded,
}: Omit<ResetCredentialDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const text = copy[kind];
  const [value, setValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<CredentialFormErrors>({});
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const valueRef = useRef<HTMLInputElement | null>(null);
  const confirmRef = useRef<HTMLInputElement | null>(null);

  const clean = (next: string) => (kind === "pin" ? sanitizePin(next) : next);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    const found = validateCredentialForm(kind, { value, confirm });
    if (found.value || found.confirm) {
      setErrors(found);
      setServiceError(null);
      if (!found.value) setConfirm("");
      requestAnimationFrame(() => (found.value ? valueRef : confirmRef).current?.focus());
      return;
    }

    setErrors({});
    setServiceError(null);
    setPending(true);
    const secret = value;
    setValue("");
    setConfirm("");
    try {
      const result =
        kind === "password"
          ? await window.vendora.users.resetPassword(user.id, secret)
          : await window.vendora.users.resetPin(user.id, secret);
      if (result.ok) {
        onSaved();
        onClose();
        return;
      }
      setServiceError(result.message);
    } catch (cause) {
      if (isSessionError(cause)) {
        onSessionEnded();
        return;
      }
      setServiceError(serviceErrorMessage);
    }
    setPending(false);
    requestAnimationFrame(() => valueRef.current?.focus());
  };

  const inputProps = {
    type: "password",
    autoComplete: kind === "password" ? "new-password" : "off",
    ...(kind === "pin" ? { inputMode: "numeric" as const, maxLength: 6 } : {}),
  };

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>
          {text.title} for {user.displayName}
        </DialogTitle>
        <DialogDescription>
          Set a new {kind} for {user.displayName}.
          {kind === "pin" ? " This also clears any PIN lockout." : ""}
        </DialogDescription>
        <div className="grid gap-400">
          <Field invalid={Boolean(errors.value)}>
            <FieldLabel>{text.label}</FieldLabel>
            <Input
              ref={valueRef}
              autoFocus
              {...inputProps}
              value={value}
              onChange={(event) => setValue(clean(event.target.value))}
            />
            {errors.value ? (
              <FieldError>{errors.value}</FieldError>
            ) : (
              <FieldDescription>{text.hint}</FieldDescription>
            )}
          </Field>
          <Field invalid={Boolean(errors.confirm)}>
            <FieldLabel>{text.confirmLabel}</FieldLabel>
            <Input
              ref={confirmRef}
              {...inputProps}
              value={confirm}
              onChange={(event) => setConfirm(clean(event.target.value))}
            />
            {errors.confirm ? <FieldError>{errors.confirm}</FieldError> : null}
          </Field>
        </div>
        {serviceError ? <ErrorLine>{serviceError}</ErrorLine> : null}
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? text.pending : text.action}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ResetCredentialDialog({ open, onOpenChange, ...rest }: ResetCredentialDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <ResetCredentialForm {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
