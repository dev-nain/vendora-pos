import { useState, type RefObject } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Kbd } from "@renderer/components/ui/kbd";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { formatRupees } from "../lib/money";
import { ErrorLine } from "../users/form-parts";

interface DiscardBillDialogProps {
  draftId: string;
  totalPaisa: number;
  held: boolean;
  returnFocus: RefObject<HTMLElement | null>;
  onDiscarded: () => void;
  onCancel: () => void;
  onSessionEnded: () => void;
}

export function DiscardBillDialog({
  draftId,
  totalPaisa,
  held,
  returnFocus,
  onDiscarded,
  onCancel,
  onSessionEnded,
}: DiscardBillDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const discard = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await window.vendora.checkout.discard(draftId);
      if (result.ok || result.reason === "not-found") {
        onDiscarded();
        return;
      }
      setError(result.message);
    } catch (cause) {
      if (isSessionError(cause)) {
        onSessionEnded();
        return;
      }
      setError(serviceErrorMessage);
    }
    setPending(false);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent finalFocus={returnFocus}>
        <DialogHeader>
          <DialogTitle>
            {held ? "Discard held bill" : "Discard this bill"} ({formatRupees(totalPaisa)})?
          </DialogTitle>
          {error ? <ErrorLine>{error}</ErrorLine> : null}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="secondary" autoFocus onClick={onCancel}>
            Cancel
            <Kbd>Esc</Kbd>
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={discard}>
            Discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
