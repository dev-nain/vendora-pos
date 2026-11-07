import { useState } from "react";

import type { PurchaseOrder } from "@shared/purchase-orders";
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
import { ErrorLine } from "../users/form-parts";

interface CancelOrderDialogProps {
  order: PurchaseOrder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancelled: (order: PurchaseOrder) => void;
  onStale: () => void;
  onSessionEnded: () => void;
}

function CancelOrderForm({
  order,
  onCancelled,
  onStale,
  onSessionEnded,
  onClose,
}: Omit<CancelOrderDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (pending) return;
    setServiceError(null);
    setPending(true);
    try {
      const result = await window.vendora.purchaseOrders.cancel(order.id);
      if (result.ok) {
        onCancelled(result.order);
        onClose();
        return;
      }
      setServiceError(result.message);
      onStale();
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
    <div>
      <DialogHeader>
        <DialogTitle>Cancel {order.orderNo}?</DialogTitle>
        <DialogDescription>
          The order is closed and can't be received against. Edits you haven't saved are dropped.
        </DialogDescription>
        {serviceError ? <ErrorLine>{serviceError}</ErrorLine> : null}
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="secondary" autoFocus onClick={onClose}>
          Keep order
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() => void submit()}
        >
          {pending ? "Cancelling…" : "Cancel order"}
        </Button>
      </DialogFooter>
    </div>
  );
}

export function CancelOrderDialog({ open, onOpenChange, ...rest }: CancelOrderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <CancelOrderForm {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
