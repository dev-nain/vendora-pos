import { useEffect, useRef, useState, type RefObject } from "react";

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
import { signedValueText } from "./stock-format";

interface PostStocktakeDialogProps {
  stocktakeId: string;
  adjustmentCount: number;
  skippedCount: number;
  netValuePaisa: number;
  returnFocus: RefObject<HTMLElement | null>;
  onPosted: (adjustmentCount: number) => void;
  onClosed: () => void;
  onKeep: () => void;
  onSessionEnded: () => void;
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

export function PostStocktakeDialog({
  stocktakeId,
  adjustmentCount,
  skippedCount,
  netValuePaisa,
  returnFocus,
  onPosted,
  onClosed,
  onKeep,
  onSessionEnded,
}: PostStocktakeDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);

  const post = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await window.vendora.stocktake.post(stocktakeId);
      if (result.ok) {
        onPosted(result.adjustmentCount);
        return;
      }
      if (result.reason === "not-open") {
        onClosed();
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
    pendingRef.current = false;
    setPending(false);
  };

  const postRef = useRef(post);
  useEffect(() => {
    postRef.current = post;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !event.ctrlKey || event.altKey || event.metaKey) return;
      event.preventDefault();
      void postRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const skipped =
    skippedCount === 0
      ? ""
      : ` ${plural(skippedCount, "line was", "lines were")} not counted and ${
          skippedCount === 1 ? "stays" : "stay"
        } unchanged.`;

  return (
    <Dialog open onOpenChange={(open) => !open && onKeep()}>
      <DialogContent finalFocus={returnFocus}>
        <DialogHeader>
          <DialogTitle>Post this count?</DialogTitle>
          <DialogDescription>
            {adjustmentCount === 0
              ? `No stock will change. The count will be marked posted.${skipped}`
              : `${plural(adjustmentCount, "adjustment", "adjustments")} will be written. Net value ${signedValueText(netValuePaisa)}.${skipped}`}
          </DialogDescription>
          {error ? <ErrorLine>{error}</ErrorLine> : null}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="secondary" autoFocus onClick={onKeep}>
            Keep reviewing
            <Kbd>Esc</Kbd>
          </Button>
          <Button type="button" disabled={pending} onClick={() => void post()}>
            Post
            <Kbd>Ctrl+Enter</Kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
