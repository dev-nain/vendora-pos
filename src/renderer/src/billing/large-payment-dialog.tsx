import type { FormEvent } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Kbd } from "@renderer/components/ui/kbd";
import { formatRupees } from "../lib/money";

interface LargePaymentDialogProps {
  paidPaisa: number;
  totalPaisa: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function LargePaymentDialog({
  paidPaisa,
  totalPaisa,
  onConfirm,
  onCancel,
}: LargePaymentDialogProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onConfirm();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {`${formatRupees(paidPaisa)} is more than 1,000 times the total of ${formatRupees(totalPaisa)}. Take this payment?`}
            </DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
              <Kbd>Esc</Kbd>
            </Button>
            <Button type="submit" autoFocus>
              Take payment
              <Kbd>Enter</Kbd>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
