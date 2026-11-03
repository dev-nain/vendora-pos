import { useState, type FormEvent } from "react";

import type { DeleteCategoryResult } from "@shared/categories";
import type { DeleteTaxCategoryResult } from "@shared/tax-categories";
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
import { deleteRefusalMessage } from "./category-actions";

interface DeleteCategoryDialogProps {
  title: string;
  open: boolean;
  remove: () => Promise<DeleteCategoryResult | DeleteTaxCategoryResult>;
  onDeleted: () => void;
  onOpenChange: (open: boolean) => void;
  onSessionEnded: () => void;
}

function DeleteCategoryForm({
  title,
  remove,
  onDeleted,
  onClose,
  onSessionEnded,
}: Omit<DeleteCategoryDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    setServiceError(null);
    setPending(true);
    try {
      const result = await remove();
      const refusal = deleteRefusalMessage(result);
      if (refusal === null) {
        onDeleted();
        onClose();
        return;
      }
      if (!result.ok && result.reason === "not-found") onDeleted();
      setServiceError(refusal);
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
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>It's removed from lists. Products keep their history.</DialogDescription>
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

export function DeleteCategoryDialog({ open, onOpenChange, ...rest }: DeleteCategoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DeleteCategoryForm {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
