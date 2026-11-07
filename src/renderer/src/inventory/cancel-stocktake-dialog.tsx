import { useState, type RefObject } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Kbd } from "@renderer/components/ui/kbd";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { ErrorLine } from "../users/form-parts";

interface CancelStocktakeDialogProps {
  stocktakeId: string;
  countedCount: number;
  returnFocus: RefObject<HTMLElement | null>;
  onCancelled: () => void;
  onKeep: () => void;
  onSessionEnded: () => void;
}

export function CancelStocktakeDialog({
  stocktakeId,
  countedCount,
  returnFocus,
  onCancelled,
  onKeep,
  onSessionEnded,
}: CancelStocktakeDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const cancel = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await window.vendora.stocktake.cancel(stocktakeId);
      if (result.ok || result.reason === "not-open") {
        onCancelled();
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
    <Dialog open onOpenChange={(open) => !open && onKeep()}>
      <DialogContent finalFocus={returnFocus}>
        <DialogHeader>
          <DialogTitle>Cancel this count?</DialogTitle>
          <DialogDescription>
            {countedCount === 1 ? "1 counted line" : `${countedCount} counted lines`} will be
            discarded. Stock doesn&apos;t change.
          </DialogDescription>
          {error ? <ErrorLine>{error}</ErrorLine> : null}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="secondary" autoFocus onClick={onKeep}>
            Keep counting
            <Kbd>Esc</Kbd>
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={cancel}>
            Cancel count
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
