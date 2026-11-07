import { ChevronLeftIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { purchaseReturnReasonLabels, type PurchaseReturn } from "@shared/purchase-returns";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import { formatDateTime } from "@renderer/lib/date-time";
import { formatRupees, rupeeInputText } from "@renderer/lib/money";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { quantityInputText } from "../lib/quantity";
import { ErrorLine } from "../users/form-parts";
import type { OrderLineDraft } from "./order-form";
import { OrderLines } from "./order-lines";

interface ReturnDetailProps {
  id: string;
  status: string | null;
  onBack: () => void;
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

const linesOf = (purchaseReturn: PurchaseReturn): OrderLineDraft[] =>
  purchaseReturn.lines.map((line) => ({
    key: line.id,
    productId: line.productId,
    nameEn: line.nameEn,
    nameUr: line.nameUr,
    unit: line.unit,
    qtyText: quantityInputText(line.qtyMilli, line.unit),
    costText: rupeeInputText(line.unitCostPaisa),
  }));

export function ReturnDetail({ id, status, onBack, onSessionEnded }: ReturnDetailProps) {
  const [purchaseReturn, setPurchaseReturn] = useState<PurchaseReturn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(status);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const fail = useCallback(
    (cause: unknown) => {
      if (isSessionError(cause)) onSessionEnded();
      else setError(serviceErrorMessage);
    },
    [onSessionEnded],
  );

  const load = useCallback(() => {
    window.vendora.purchaseReturns
      .get(id)
      .then((result) => {
        if (result.ok) {
          setPurchaseReturn(result.purchaseReturn);
          setError(null);
        } else setError(result.message);
      })
      .catch(fail);
  }, [id, fail]);

  useEffect(load, [load]);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        await action();
      } catch (cause) {
        fail(cause);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [fail],
  );

  const print = useCallback(
    () =>
      run(async () => {
        const result = await window.vendora.purchaseReturns.print(id);
        if (!result.ok) {
          setMessage(null);
          setError(result.message);
        } else setError(null);
      }),
    [id, run],
  );

  const savePdf = useCallback(
    () =>
      run(async () => {
        const result = await window.vendora.purchaseReturns.savePdf(id);
        if (!result.ok) {
          setMessage(null);
          setError(result.message);
        } else if (result.status === "saved") {
          setError(null);
          setMessage(`Saved to ${result.path}.`);
        }
      }),
    [id, run],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as Element | null)?.closest('[role="dialog"]')) return;
      if (event.ctrlKey && !event.altKey && !event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === "p" && !event.shiftKey) {
          event.preventDefault();
          void print();
        } else if (key === "s" && event.shiftKey) {
          event.preventDefault();
          void savePdf();
        }
        return;
      }
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onBack();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onBack, print, savePdf]);

  return (
    <div className="flex flex-col gap-500">
      <div className="flex flex-col items-start gap-300">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
          Purchase returns
          <Kbd>Esc</Kbd>
        </Button>
        <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground tabular-nums">
          {purchaseReturn ? purchaseReturn.returnNo : "Purchase return"}
        </h1>
      </div>
      <p role="status" aria-live="polite" className="m-0 text-secondary empty:hidden">
        {message}
      </p>
      {error ? (
        <div className="flex items-center gap-300">
          <ErrorLine>{error}</ErrorLine>
          {purchaseReturn ? null : (
            <Button variant="secondary" onClick={load}>
              Try again
            </Button>
          )}
        </div>
      ) : null}
      {purchaseReturn ? (
        <>
          <dl className="m-0 grid grid-cols-2 gap-x-400 gap-y-300">
            <Fact label="Supplier">{purchaseReturn.supplierName}</Fact>
            <Fact label="Reason">{purchaseReturnReasonLabels[purchaseReturn.reason]}</Fact>
            <Fact label="Goods received note">
              {purchaseReturn.grnNo ?? "None, returned from supplier"}
            </Fact>
            {purchaseReturn.supplierInvoiceNo ? (
              <Fact label="Supplier invoice number">{purchaseReturn.supplierInvoiceNo}</Fact>
            ) : null}
            <Fact label="Returned">{formatDateTime(purchaseReturn.createdAt)}</Fact>
            <Fact label="Returned by">{purchaseReturn.actorName}</Fact>
          </dl>
          {purchaseReturn.notes ? (
            <p className="m-0 whitespace-pre-wrap text-[length:var(--font-size-400)] text-foreground">
              {purchaseReturn.notes}
            </p>
          ) : null}
          <OrderLines
            label="Purchase return lines"
            lines={linesOf(purchaseReturn)}
            editable={false}
            errors={noErrors}
            onChange={noop}
            onRemove={noop}
            onReturnToScan={noop}
          />
          <div className="flex items-center justify-end gap-400 border-t border-line py-300">
            <span className="text-[length:var(--font-size-450)] text-secondary">Total</span>
            <span className="text-[length:var(--font-size-550)] font-semibold tabular-nums text-foreground">
              {formatRupees(purchaseReturn.totalPaisa)}
            </span>
          </div>
          <div className="flex items-center justify-end gap-300">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              focusableWhenDisabled
              onClick={() => void print()}
            >
              Print
              <Kbd>Ctrl+P</Kbd>
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              focusableWhenDisabled
              onClick={() => void savePdf()}
            >
              Save as PDF
              <Kbd>Ctrl+Shift+S</Kbd>
            </Button>
          </div>
        </>
      ) : error ? null : (
        <p className="m-0 text-secondary">Loading purchase return…</p>
      )}
    </div>
  );
}
