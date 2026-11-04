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

interface QuantityConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function QuantityConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: QuantityConfirmDialogProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onConfirm();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{message}</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
              <Kbd>Esc</Kbd>
            </Button>
            <Button type="submit" autoFocus>
              Set quantity
              <Kbd>Enter</Kbd>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
