import { useState, type FormEvent } from "react";

import type { ProductSearchItem } from "@shared/products";
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

interface DeleteProductDialogProps {
  item: ProductSearchItem;
  open: boolean;
  onDeleted: () => void;
  onOpenChange: (open: boolean) => void;
  onSessionEnded: () => void;
}

function DeleteProductForm({
  item,
  onDeleted,
  onClose,
  onSessionEnded,
}: Omit<DeleteProductDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    setServiceError(null);
    setPending(true);
    try {
      const result = await window.vendora.products.delete(item.id);
      if (result.ok) {
        onDeleted();
        onClose();
        return;
      }
      if (result.reason === "not-found") onDeleted();
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
        <DialogTitle>Delete {item.nameEn}?</DialogTitle>
        <DialogDescription>
          It's removed from the catalog and search, and its barcodes are freed for other products.
        </DialogDescription>
        {serviceError ? <ErrorLine>{serviceError}</ErrorLine> : null}
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="secondary" autoFocus onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Deleting…" : "Delete"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function DeleteProductDialog({ open, onOpenChange, ...rest }: DeleteProductDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DeleteProductForm {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
