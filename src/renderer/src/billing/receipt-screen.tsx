import { CircleCheckIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CompletedSale } from "@shared/checkout";
import { printerMessages, type PrintResult, type SaleJobResult } from "@shared/receipt";
import { PrintWarning } from "@renderer/components/print-warning";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import { formatRupees } from "../lib/money";
import { InvoiceActions, useInvoiceActions } from "../orders/invoice-actions";
import { invoiceShortcut } from "../orders/invoice-shortcut";
import { createBurstDetector } from "./scan-burst";

interface ReceiptScreenProps {
  sale: CompletedSale;
  active: boolean;
  onNewBill: (scannedCode?: string) => void;
  onPrinterChanged: () => void;
  onOpenPrinterSettings: () => void;
  onAskingChange: (asking: boolean) => void;
}

function Figure({ label, paisa }: { label: string; paisa: number }) {
  return (
    <div className="grid gap-100">
      <dt className="text-[length:var(--font-size-450)] text-secondary">{label}</dt>
      <dd className="m-0 font-display text-[length:var(--font-size-1400)] leading-[var(--line-height-tight)] font-semibold text-foreground tabular-nums">
        {formatRupees(paisa)}
      </dd>
    </div>
  );
}

const ignoreError = () => undefined;

type Manual = { phase: "running" } | { phase: "done"; result: PrintResult };

const jobFailed = (message: string): SaleJobResult => ({
  state: "failed",
  canRetry: true,
  message,
});

export function ReceiptScreen({
  sale,
  active,
  onNewBill,
  onPrinterChanged,
  onOpenPrinterSettings,
  onAskingChange,
}: ReceiptScreenProps) {
  const newBill = useRef(onNewBill);
  const printerChanged = useRef(onPrinterChanged);
  const askingChange = useRef(onAskingChange);
  useEffect(() => {
    newBill.current = onNewBill;
    printerChanged.current = onPrinterChanged;
    askingChange.current = onAskingChange;
  });

  const [job, setJob] = useState<SaleJobResult | null>(null);
  const [answered, setAnswered] = useState(false);
  const [manual, setManual] = useState<Manual | null>(null);
  const newBillButton = useRef<HTMLButtonElement | null>(null);
  const running = useRef(false);
  const invoice = useInvoiceActions(sale.id, ignoreError);
  const { print: printInvoice, savePdf: saveInvoice } = invoice;

  useEffect(() => {
    let live = true;
    window.vendora.receipts
      .saleJob(sale.id)
      .then((result) => {
        if (live) setJob(result);
      })
      .catch(() => {
        if (live) setJob(jobFailed(printerMessages.error));
      })
      .finally(() => printerChanged.current());
    return () => {
      live = false;
    };
  }, [sale.id]);

  const asking = job?.state === "ask" && !answered && manual === null;
  useEffect(() => askingChange.current(asking), [asking]);
  useEffect(() => () => askingChange.current(false), []);

  const runPrint = useCallback(() => {
    if (running.current) return;
    running.current = true;
    setAnswered(true);
    setManual({ phase: "running" });
    window.vendora.receipts
      .print(sale.id)
      .then((result) => setManual({ phase: "done", result }))
      .catch(() =>
        setManual({
          phase: "done",
          result: { successful: false, canRetry: true, message: printerMessages.error },
        }),
      )
      .finally(() => {
        running.current = false;
        printerChanged.current();
        newBillButton.current?.focus();
      });
  }, [sale.id]);

  const skip = useCallback(() => {
    setAnswered(true);
    newBillButton.current?.focus();
  }, []);

  useEffect(() => {
    if (!active) return;
    const detector = createBurstDetector();
    const onKeyDown = (event: KeyboardEvent) => {
      const result = detector.feed(event.key, event.timeStamp);
      if (result.scan === null) return;
      event.preventDefault();
      event.stopPropagation();
      newBill.current(result.scan);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const invoiceAction = invoiceShortcut(event);
      if (invoiceAction) {
        event.preventDefault();
        if (invoiceAction === "print") printInvoice();
        else saveInvoice();
      } else if (
        event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        event.key.toLowerCase() === "p"
      ) {
        event.preventDefault();
        runPrint();
      } else if (event.key === "Escape" && asking) {
        event.preventDefault();
        skip();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, asking, printInvoice, saveInvoice, runPrint, skip]);

  const outcome: PrintResult | null =
    manual?.phase === "done"
      ? manual.result
      : manual === null && job?.state === "failed"
        ? { successful: false, canRetry: job.canRetry, message: job.message }
        : manual === null && job?.state === "no-printer"
          ? { successful: false, canRetry: false, message: printerMessages.notSetUp }
          : null;
  const noPrinter = outcome?.message === printerMessages.notSetUp && !outcome.successful;
  const failure = outcome && !outcome.successful && !noPrinter ? outcome : null;
  const printing = manual?.phase === "running" || (job === null && manual === null);
  const sent = outcome?.successful === true;

  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-600">
      <div className="grid w-full max-w-[960px] gap-600">
        <div className="grid gap-200">
          <div className="flex items-center gap-300">
            <CircleCheckIcon
              aria-hidden="true"
              size={24}
              strokeWidth={2}
              className="text-[var(--color-icon-success)]"
            />
            <h1 className="m-0 text-[length:var(--font-size-700)] font-semibold text-foreground">
              {sale.type === "refund" ? "Refund saved" : "Sale saved"}
            </h1>
          </div>
          <p className="m-0 text-[length:var(--font-size-450)] text-secondary tabular-nums">
            Invoice {sale.invoiceNo}
          </p>
        </div>
        {sale.type === "refund" ? (
          <dl className="m-0 grid grid-cols-3 gap-600">
            <Figure label="Refund" paisa={-sale.totalPaisa} />
          </dl>
        ) : (
          <dl className="m-0 grid grid-cols-3 gap-600">
            <Figure label="Total" paisa={sale.totalPaisa} />
            <Figure label="Paid" paisa={sale.totalPaisa + sale.changePaisa} />
            <Figure label="Change" paisa={sale.changePaisa} />
          </dl>
        )}
        {printing ? (
          <p role="status" className="m-0 text-[length:var(--font-size-350)] text-secondary">
            Printing…
          </p>
        ) : null}
        {failure ? (
          <PrintWarning
            title={printerMessages.didNotPrint}
            message={failure.message}
            hint="Reprint later from Orders."
            onRetry={failure.canRetry ? runPrint : undefined}
          />
        ) : null}
        {noPrinter ? (
          <PrintWarning
            title={printerMessages.notSetUp}
            action={
              <Button variant="secondary" onClick={onOpenPrinterSettings}>
                Printer settings
              </Button>
            }
          />
        ) : null}
        {sent ? (
          <p role="status" className="m-0 text-[length:var(--font-size-350)] text-secondary">
            Receipt sent to the printer.
          </p>
        ) : null}
        {asking ? (
          <div className="flex items-center gap-300">
            <p className="m-0 text-[length:var(--font-size-450)] text-foreground">
              Print the receipt?
            </p>
            <Button autoFocus onClick={runPrint}>
              Print
              <Kbd>Enter</Kbd>
            </Button>
            <Button variant="secondary" onClick={skip}>
              Skip
              <Kbd>Esc</Kbd>
            </Button>
          </div>
        ) : null}
        <div className="flex items-center gap-200">
          <Button ref={newBillButton} size="lg" autoFocus={!asking} onClick={() => onNewBill()}>
            New bill
            {asking ? null : <Kbd>Enter</Kbd>}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            disabled={manual?.phase === "running"}
            onClick={runPrint}
          >
            {failure?.canRetry ? "Retry" : "Print"}
            <Kbd>Ctrl+P</Kbd>
          </Button>
        </div>
        <div className="flex items-center gap-200">
          <InvoiceActions
            busy={invoice.busy}
            status={invoice.status}
            error={invoice.error}
            onPrint={invoice.print}
            onSavePdf={invoice.savePdf}
          />
        </div>
      </div>
    </div>
  );
}
