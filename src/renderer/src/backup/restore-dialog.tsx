import { useState, type FormEvent, type RefObject } from "react";

import type { RestoreInput, RestoreRefusal } from "@shared/backup";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { formatDateTime } from "@renderer/lib/date-time";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { ErrorLine } from "../users/form-parts";

export interface RestoreTarget {
  input: RestoreInput;
  takenAt: string;
  pickedFileName: string | null;
}

interface RestoreDialogProps {
  target: RestoreTarget;
  open: boolean;
  finalFocus: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  onRefused: () => void;
  onSessionEnded: () => void;
}

interface Refusal {
  reason: RestoreRefusal;
  message: string;
}

function RestoreForm({
  target,
  onClose,
  onRefused,
  onSessionEnded,
  onPendingChange,
}: Pick<RestoreDialogProps, "target" | "onRefused" | "onSessionEnded"> & {
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    setRefusal(null);
    setFailure(null);
    setPending(true);
    onPendingChange(true);
    try {
      const result = await window.vendora.backup.restore(target.input);
      if (result.ok) return;
      setRefusal({ reason: result.reason, message: result.message });
      if (result.reason !== "backup-failed") onRefused();
    } catch (cause) {
      if (isSessionError(cause)) {
        onSessionEnded();
        return;
      }
      setFailure(serviceErrorMessage);
    }
    setPending(false);
    onPendingChange(false);
  };

  const canRetry = refusal === null || refusal.reason === "backup-failed";
  const message = refusal?.message ?? failure;

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Restore backup from {formatDateTime(target.takenAt)}?</DialogTitle>
        <DialogDescription>
          This replaces all current data with this backup. Your current data is backed up first, and
          Vendora restarts when it's done.
        </DialogDescription>
        {target.pickedFileName ? (
          <p className="m-0 text-[length:var(--font-size-350)] break-all text-foreground">
            {target.pickedFileName}
          </p>
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
          <Button type="button" variant="secondary" autoFocus onClick={onClose}>
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
          onClose={() => onOpenChange(false)}
          onRefused={onRefused}
          onSessionEnded={onSessionEnded}
          onPendingChange={setPending}
        />
      </DialogContent>
    </Dialog>
  );
}
