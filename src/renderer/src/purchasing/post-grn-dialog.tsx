import { TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

import type { GoodsReceivedNote, PostGoodsReceivedInput } from "@shared/goods-received";
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
import { formatQuantity } from "../lib/quantity";
import { ErrorLine } from "../users/form-parts";
import type { OverReceipt } from "./grn-form";

interface PostGrnSummary {
  supplierName: string;
  supplierInvoiceNo: string;
  lineCount: number;
  totalPaisa: number;
  overReceipts: readonly OverReceipt[];
}

interface PostGrnDialogProps {
  payload: PostGoodsReceivedInput | null;
  summary: PostGrnSummary;
  finalFocus: RefObject<HTMLElement | null>;
  onClose: () => void;
  onPosted: (note: GoodsReceivedNote) => void;
  onSessionEnded: () => void;
}

const lineCountLabel = (count: number) => `${count} ${count === 1 ? "line" : "lines"}`;

function PostGrnForm({
  payload,
  summary,
  onClose,
  onPosted,
  onSessionEnded,
}: Omit<PostGrnDialogProps, "finalFocus"> & { payload: PostGoodsReceivedInput }) {
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const extra = summary.overReceipts.length > 0;

  const submit = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setServiceError(null);
    setPending(true);
    try {
      const result = await window.vendora.goodsReceived.post(payload);
      if (result.ok) {
        onPosted(result.note);
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
        <DialogTitle>Post this goods received note?</DialogTitle>
        <DialogDescription>
          {summary.supplierName}, invoice {summary.supplierInvoiceNo},{" "}
          {lineCountLabel(summary.lineCount)}, total {formatRupees(summary.totalPaisa)}. Stock and
          costs update now. A posted note can't be edited.
        </DialogDescription>
        {extra ? (
          <div className="flex items-start gap-200 rounded-300 border border-line-warning bg-surface-warning p-300 text-foreground">
            <TriangleAlertIcon
              aria-hidden="true"
              size={16}
              strokeWidth={2}
              className="mt-[2px] shrink-0 text-icon-warning"
            />
            <div className="grid min-w-0 gap-100">
              <p className="m-0 font-semibold text-warning">More than was ordered</p>
              <ul className="m-0 grid max-h-[140px] list-none gap-050 overflow-y-auto p-0 text-[length:var(--font-size-350)] tabular-nums">
                {summary.overReceipts.map((line) => (
                  <li key={line.key}>
                    {line.nameEn} — {formatQuantity(line.extraMilli, line.unit)} extra
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        {serviceError ? <ErrorLine>{serviceError}</ErrorLine> : null}
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="secondary" autoFocus onClick={onClose}>
          Keep editing
          <Kbd>Esc</Kbd>
        </Button>
        <Button type="button" disabled={pending} onClick={() => void submit()}>
          {pending ? "Posting…" : extra ? "Post with extra" : "Post"}
          <Kbd>Ctrl+Enter</Kbd>
        </Button>
      </DialogFooter>
    </div>
  );
}

export function PostGrnDialog({ payload, finalFocus, onClose, ...rest }: PostGrnDialogProps) {
  return (
    <Dialog open={payload !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent finalFocus={finalFocus}>
        {payload ? <PostGrnForm payload={payload} onClose={onClose} {...rest} /> : null}
      </DialogContent>
    </Dialog>
  );
}
