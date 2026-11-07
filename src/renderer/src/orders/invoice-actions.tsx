import { useCallback, useRef, useState } from "react";

import type { PrintInvoiceResult, SaveInvoicePdfResult } from "@shared/invoices";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import { serviceErrorMessage } from "../auth/messages";
import { ErrorLine } from "../users/form-parts";

interface Outcome {
  saleId: string;
  status: string | null;
  error: string | null;
}

export function useInvoiceActions(saleId: string | null, onError: (cause: unknown) => void) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const running = useRef(false);

  const run = useCallback(
    async (call: (id: string) => Promise<SaveInvoicePdfResult | PrintInvoiceResult>) => {
      if (saleId === null || running.current) return;
      running.current = true;
      setBusy(true);
      setOutcome({ saleId, status: null, error: null });
      try {
        const result = await call(saleId);
        if (!result.ok) {
          setOutcome({ saleId, status: null, error: result.message });
        } else if (result.status === "saved") {
          setOutcome({ saleId, status: `Invoice saved to ${result.path}.`, error: null });
        }
      } catch (cause) {
        onError(cause);
        setOutcome({ saleId, status: null, error: serviceErrorMessage });
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [saleId, onError],
  );

  const print = useCallback(() => void run((id) => window.vendora.invoices.print(id)), [run]);
  const savePdf = useCallback(() => void run((id) => window.vendora.invoices.savePdf(id)), [run]);

  const current = outcome?.saleId === saleId ? outcome : null;
  return { busy, status: current?.status ?? null, error: current?.error ?? null, print, savePdf };
}

interface InvoiceActionsProps {
  busy: boolean;
  status: string | null;
  error: string | null;
  onPrint: () => void;
  onSavePdf: () => void;
}

export function InvoiceActions({ busy, status, error, onPrint, onSavePdf }: InvoiceActionsProps) {
  return (
    <>
      <Button variant="secondary" disabled={busy} focusableWhenDisabled onClick={onPrint}>
        Print invoice
        <Kbd>Ctrl+Shift+P</Kbd>
      </Button>
      <Button variant="secondary" disabled={busy} focusableWhenDisabled onClick={onSavePdf}>
        Save invoice PDF
        <Kbd>Ctrl+Shift+S</Kbd>
      </Button>
      {error ? <ErrorLine>{error}</ErrorLine> : null}
      {status ? (
        <p
          role="status"
          aria-live="polite"
          className="m-0 text-[length:var(--font-size-350)] text-secondary"
        >
          {status}
        </p>
      ) : null}
    </>
  );
}
