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
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { ErrorLine } from "./form-parts";
import { validateDisplayName } from "./user-form";

interface EditUserDialogProps {
  user: ManagedUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onSessionEnded: () => void;
}

function EditUserForm({
  user,
  onClose,
  onSaved,
  onSessionEnded,
}: Omit<EditUserDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [nameError, setNameError] = useState<string | undefined>();
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    const invalid = validateDisplayName(displayName);
    if (invalid) {
      setNameError(invalid);
      setServiceError(null);
      requestAnimationFrame(() => nameRef.current?.focus());
      return;
    }

    setNameError(undefined);
    setServiceError(null);
    setPending(true);
    try {
      const result = await window.vendora.users.update({ id: user.id, displayName });
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
  };

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>Edit {user.displayName}</DialogTitle>
        <DialogDescription>Change the display name. Usernames can't be changed.</DialogDescription>
        <div className="grid gap-400">
          <div className="grid gap-200">
            <span className="text-[length:var(--font-size-350)] font-semibold text-foreground">
              Username
            </span>
            <span className="text-[length:var(--font-size-400)] text-secondary">
              {user.username}
            </span>
          </div>
          <Field invalid={Boolean(nameError)}>
            <FieldLabel>Display name</FieldLabel>
            <Input
              ref={nameRef}
              autoFocus
              autoComplete="off"
              maxLength={64}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            {nameError ? <FieldError>{nameError}</FieldError> : null}
          </Field>
        </div>
        {serviceError ? <ErrorLine>{serviceError}</ErrorLine> : null}
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function EditUserDialog({ open, onOpenChange, ...rest }: EditUserDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <EditUserForm {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
