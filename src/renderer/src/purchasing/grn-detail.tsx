import { ChevronLeftIcon, PackageMinusIcon } from "lucide-react";
import { useCallback, useEffect, useState, type RefObject } from "react";

import type { GoodsReceivedNote } from "@shared/goods-received";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import { formatDateTime } from "@renderer/lib/date-time";
import { formatRupees } from "@renderer/lib/money";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { isTypingTarget } from "../products/product-list";
import { ErrorLine } from "../users/form-parts";
import { grnFormFromNote } from "./grn-form";
import { OrderLines } from "./order-lines";

interface GrnDetailProps {
  id: string;
  status: string | null;
  backRef?: RefObject<HTMLButtonElement | null>;
  onBack: () => void;
  onReturn: (noteId: string) => void;
  onSessionEnded: () => void;
}

const noErrors = {};
const noop = () => undefined;

function Fact({ label, children }: { label: string; children: string }) {
  return (
    <div className="grid gap-050">
      <dt className="text-[length:var(--font-size-300)] text-secondary">{label}</dt>
      <dd className="m-0 text-[length:var(--font-size-400)] tabular-nums text-foreground">
        {children}
      </dd>
    </div>
  );
}

export function GrnDetail({
  id,
  status,
  backRef,
  onBack,
  onReturn,
  onSessionEnded,
}: GrnDetailProps) {
  const [note, setNote] = useState<GoodsReceivedNote | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    window.vendora.goodsReceived
      .get(id)
      .then((result) => {
        if (result.ok) {
          setNote(result.note);
          setError(null);
        } else setError(result.message);
      })
      .catch((cause: unknown) => {
        if (isSessionError(cause)) onSessionEnded();
        else setError(serviceErrorMessage);
      });
  }, [id, onSessionEnded]);

  useEffect(load, [load]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if ((event.target as Element | null)?.closest('[role="dialog"]')) return;
      event.preventDefault();
      onBack();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onBack]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "r" || event.ctrlKey || event.altKey || event.metaKey) return;
      if (isTypingTarget(event.target) || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      onReturn(id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [id, onReturn]);

  return (
    <div className="flex flex-col gap-500">
      <div className="flex flex-col items-start gap-300">
        <div className="flex items-center gap-300">
          <Button ref={backRef} type="button" variant="ghost" size="sm" onClick={onBack}>
            <ChevronLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
            Goods received
            <Kbd>Esc</Kbd>
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => onReturn(id)}>
            <PackageMinusIcon aria-hidden="true" size={16} strokeWidth={2} />
            Return to supplier
            <Kbd>R</Kbd>
          </Button>
        </div>
        <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground tabular-nums">
          {note ? note.grnNo : "Goods received note"}
        </h1>
      </div>
      {status ? (
        <p role="status" aria-live="polite" className="m-0 text-secondary">
          {status}
        </p>
      ) : null}
      {error ? (
        <div className="flex items-center gap-300">
          <ErrorLine>{error}</ErrorLine>
          <Button variant="secondary" onClick={load}>
            Try again
          </Button>
        </div>
      ) : null}
      {note ? (
        <>
          <dl className="m-0 grid grid-cols-2 gap-x-400 gap-y-300">
            <Fact label="Supplier">{note.supplierName}</Fact>
            <Fact label="Supplier invoice number">{note.supplierInvoiceNo}</Fact>
            <Fact label="Purchase order">{note.orderNo ?? "None, received directly"}</Fact>
            <Fact label="Received">{formatDateTime(note.createdAt)}</Fact>
          </dl>
          <OrderLines
            label="Goods received lines"
            lines={grnFormFromNote(note)}
            editable={false}
            errors={noErrors}
            onChange={noop}
            onRemove={noop}
            onReturnToScan={noop}
          />
          <div className="flex items-center justify-end gap-400 border-t border-line py-300">
            <span className="text-[length:var(--font-size-450)] text-secondary">Total</span>
            <span className="text-[length:var(--font-size-550)] font-semibold tabular-nums text-foreground">
              {formatRupees(note.totalPaisa)}
            </span>
          </div>
        </>
      ) : error ? null : (
        <p className="m-0 text-secondary">Loading goods received note…</p>
      )}
    </div>
  );
}
