import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import type { Bill } from "@shared/checkout";
import type { HeldBillSummary } from "@shared/shifts";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Kbd } from "@renderer/components/ui/kbd";
import { cn } from "@renderer/lib/utils";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { formatTime } from "../lib/date-time";
import { formatRupees } from "../lib/money";
import { ErrorLine } from "../users/form-parts";
import { itemCountText } from "./bill-format";

interface HeldBillsDialogProps {
  returnFocus: RefObject<HTMLElement | null>;
  onResumed: (bill: Bill) => void;
  onDiscard: (bill: HeldBillSummary) => void;
  onClose: () => void;
  onSessionEnded: () => void;
}

const rowId = (id: string) => `held-bill-${id}`;

const itemNamesText = (bill: HeldBillSummary) =>
  bill.itemNames.join(", ") + (bill.lineCount > bill.itemNames.length ? ", …" : "");

export function HeldBillsDialog({
  returnFocus,
  onResumed,
  onDiscard,
  onClose,
  onSessionEnded,
}: HeldBillsDialogProps) {
  const [bills, setBills] = useState<HeldBillSummary[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const list = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.vendora.checkout
      .listHeld()
      .then(setBills)
      .catch((cause: unknown) => {
        if (isSessionError(cause)) onSessionEnded();
        else setError(serviceErrorMessage);
      });
  }, [onSessionEnded]);

  const current = bills?.[selected] ?? null;

  const resume = async () => {
    if (!current || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await window.vendora.checkout.resume(current.id);
      if (result.ok) {
        onResumed(result.bill);
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

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!bills || bills.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((index) => Math.min(index + 1, bills.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      void resume();
    } else if (event.key === "Delete" && current) {
      event.preventDefault();
      onDiscard(current);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        finalFocus={returnFocus}
        initialFocus={list}
        className="w-[min(640px,calc(100vw-32px))]"
      >
        <DialogHeader>
          <DialogTitle>Held bills</DialogTitle>
          {bills !== null && bills.length === 0 ? (
            <p className="m-0 text-secondary">No bills on hold.</p>
          ) : (
            <div
              role="listbox"
              aria-label="Held bills"
              aria-activedescendant={current ? rowId(current.id) : undefined}
              ref={list}
              tabIndex={0}
              onKeyDown={onKeyDown}
              className="grid max-h-[320px] gap-050 overflow-y-auto rounded-100 outline-none focus-visible:shadow-focus"
            >
              {(bills ?? []).map((bill, index) => (
                <div
                  key={bill.id}
                  id={rowId(bill.id)}
                  role="option"
                  aria-selected={index === selected}
                  onClick={() => setSelected(index)}
                  onDoubleClick={() => void resume()}
                  className={cn(
                    "grid min-h-[var(--height-row)] cursor-pointer content-center gap-050 rounded-100 px-300 py-200",
                    index === selected ? "selection-pill" : "hover:bg-surface-hover",
                  )}
                >
                  <span className="text-[length:var(--font-size-400)] font-semibold text-foreground tabular-nums">
                    {formatTime(bill.heldAt)} · {bill.cashier} · {itemCountText(bill.lineCount)} ·{" "}
                    {formatRupees(bill.totalPaisa)}
                  </span>
                  <span className="truncate text-[length:var(--font-size-300)] text-secondary">
                    {itemNamesText(bill)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {error ? <ErrorLine>{error}</ErrorLine> : null}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
            <Kbd>Esc</Kbd>
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!current}
            onClick={() => current && onDiscard(current)}
          >
            Discard
            <Kbd>Del</Kbd>
          </Button>
          <Button type="button" disabled={!current || pending} onClick={() => void resume()}>
            Resume
            <Kbd>Enter</Kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
