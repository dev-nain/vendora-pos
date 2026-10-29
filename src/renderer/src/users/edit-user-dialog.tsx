import { TriangleAlertIcon } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import type { SafeUser } from "@shared/auth";
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
import { ErrorLine, RoleSelect } from "./form-parts";
import { validateDisplayName } from "./user-form";

interface EditUserDialogProps {
  user: ManagedUser;
  open: boolean;
  isCurrentUser: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onSessionEnded: () => void;
}

function EditUserForm({
  user,
  isCurrentUser,
  onClose,
  onSaved,
  onSessionEnded,
}: Omit<EditUserDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<SafeUser["role"]>(user.role);
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
      const result = await window.vendora.users.update({ id: user.id, displayName, role });
      if (result.ok) {
        if (result.sessionEnded) {
          onSessionEnded();
          return;
        }
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
        <DialogDescription>Change the name or role. Usernames can't be changed.</DialogDescription>
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
          <RoleSelect value={role} onChange={setRole} />
          {isCurrentUser && role !== user.role ? (
            <p className="m-0 flex items-center gap-100 text-[length:var(--font-size-350)] font-medium text-warning">
              <TriangleAlertIcon
                aria-hidden="true"
                size={14}
                strokeWidth={2}
                className="shrink-0"
              />
              You'll be signed out and need to log in again.
            </p>
          ) : null}
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
