import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";

interface DiscardChangesDialogProps {
  noun: "product" | "supplier" | "purchase order" | "goods received note" | "purchase return";
  open: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
}

export function DiscardChangesDialog({
  noun,
  open,
  onKeepEditing,
  onDiscard,
}: DiscardChangesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onKeepEditing())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard changes?</DialogTitle>
          <DialogDescription>Your changes to this {noun} won't be saved.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="secondary" autoFocus onClick={onKeepEditing}>
            Keep editing
          </Button>
          <Button type="button" variant="destructive" onClick={onDiscard}>
            Discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
