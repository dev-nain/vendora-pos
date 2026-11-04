import { useState, type FormEvent } from "react";

import type { CashMove } from "@shared/shifts";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { formatRupees } from "@renderer/lib/money";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { ErrorLine } from "../users/form-parts";

interface DeleteCashMoveDialogProps {
  move: CashMove;
  opener: HTMLElement;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
  onSessionEnded: () => void;
}

function DeleteCashMoveForm({
  move,
  onClose,
  onDeleted,
  onSessionEnded,
}: Omit<DeleteCashMoveDialogProps, "opener" | "onOpenChange"> & { onClose: () => void }) {
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    setServiceError(null);
    setPending(true);
    try {
      const result = await window.vendora.shifts.deleteCashMove(move.id);
      if (result.ok) {
        onDeleted();
        onClose();
        return;
      }
      onDeleted();
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
        <DialogTitle>
          Delete cash {move.kind} of {formatRupees(move.amountPaisa)} ({move.reason})?
        </DialogTitle>
        <DialogDescription>
          It leaves the expected cash and the report. The deletion is kept in the audit log.
        </DialogDescription>
        {serviceError ? <ErrorLine>{serviceError}</ErrorLine> : null}
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" autoFocus disabled={pending}>
          {pending ? "Deleting…" : "Delete"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function DeleteCashMoveDialog({ opener, onOpenChange, ...rest }: DeleteCashMoveDialogProps) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent finalFocus={() => (opener.isConnected ? opener : true)}>
        <DeleteCashMoveForm {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
