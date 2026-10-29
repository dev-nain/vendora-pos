import { useState, type FormEvent } from "react";

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
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { ErrorLine } from "./form-parts";

interface DeactivateUserDialogProps {
  user: ManagedUser;
  open: boolean;
  isCurrentUser: boolean;
  onOpenChange: (open: boolean) => void;
  onDeactivated: () => void;
  onSessionEnded: () => void;
}

function DeactivateUserForm({
  user,
  isCurrentUser,
  onClose,
  onDeactivated,
  onSessionEnded,
}: Omit<DeactivateUserDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    setServiceError(null);
    setPending(true);
    try {
      const result = await window.vendora.users.deactivate(user.id);
      if (result.ok) {
        if (result.sessionEnded) {
          onSessionEnded();
          return;
        }
        onDeactivated();
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
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Deactivate {user.displayName}?</DialogTitle>
        <DialogDescription>
          They won't be able to log in. Their username stays reserved and you can reactivate them
          later.
          {isCurrentUser ? " You'll be signed out." : ""}
        </DialogDescription>
        {serviceError ? <ErrorLine>{serviceError}</ErrorLine> : null}
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="secondary" autoFocus onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Deactivating…" : "Deactivate"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function DeactivateUserDialog({ open, onOpenChange, ...rest }: DeactivateUserDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DeactivateUserForm {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
