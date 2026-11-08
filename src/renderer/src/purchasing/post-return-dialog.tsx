import { useEffect, useRef, useState, type RefObject } from "react";

import type { PostPurchaseReturnInput, PurchaseReturn } from "@shared/purchase-returns";
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
import { formatRupees } from "@renderer/lib/money";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { ErrorLine } from "../users/form-parts";

interface PostReturnSummary {
  supplierName: string;
  reasonLabel: string;
  lineCount: number;
  totalPaisa: number;
}

interface PostReturnDialogProps {
  payload: PostPurchaseReturnInput | null;
  summary: PostReturnSummary;
  finalFocus: RefObject<HTMLElement | null>;
  onClose: () => void;
  onPosted: (purchaseReturn: PurchaseReturn) => void;
  onSessionEnded: () => void;
}

const lineCountLabel = (count: number) => `${count} ${count === 1 ? "line" : "lines"}`;

function PostReturnForm({
  payload,
  summary,
  onClose,
  onPosted,
  onSessionEnded,
}: Omit<PostReturnDialogProps, "finalFocus"> & { payload: PostPurchaseReturnInput }) {
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  const submit = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setServiceError(null);
    setPending(true);
    try {
      const result = await window.vendora.purchaseReturns.post(payload);
      if (result.ok) {
        onPosted(result.purchaseReturn);
        return;
      }
      setServiceError(result.message);
    } catch (cause) {
      if (isSessionError(cause)) {
        onSessionEnded();
        return;
      }
      setServiceError(serviceErrorMessage);
    }
    pendingRef.current = false;
    setPending(false);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div>
      <DialogHeader>
        <DialogTitle>Return these goods to {summary.supplierName}?</DialogTitle>
        <DialogDescription>
          {summary.reasonLabel}, {lineCountLabel(summary.lineCount)}, total{" "}
          {formatRupees(summary.totalPaisa)}. Stock goes down now. A posted return can't be edited.
        </DialogDescription>
        {serviceError ? <ErrorLine>{serviceError}</ErrorLine> : null}
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="secondary" autoFocus onClick={onClose}>
          Keep editing
          <Kbd>Esc</Kbd>
        </Button>
        <Button type="button" disabled={pending} onClick={() => void submit()}>
          {pending ? "Posting…" : "Post return"}
          <Kbd>Ctrl+Enter</Kbd>
        </Button>
      </DialogFooter>
    </div>
  );
}

export function PostReturnDialog({ payload, finalFocus, onClose, ...rest }: PostReturnDialogProps) {
  return (
    <Dialog open={payload !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent finalFocus={finalFocus}>
        {payload ? <PostReturnForm payload={payload} onClose={onClose} {...rest} /> : null}
      </DialogContent>
    </Dialog>
  );
}
