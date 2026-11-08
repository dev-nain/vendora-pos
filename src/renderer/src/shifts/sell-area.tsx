import { useCallback, useEffect, useRef, useState } from "react";

import type { PrinterStatus } from "@shared/receipt";
import type { AddCashMoveInput, ShiftReport, ShiftState } from "@shared/shifts";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { BillingScreen, type BillingStep } from "../billing/billing-screen";
import type { Hint } from "../shell/hint-bar";
import { CashMoveDialog } from "./cash-move-dialog";
import { CloseShiftScreen } from "./close-shift-screen";
import { OrdersScreen } from "../orders/orders-screen";
import { OpenShiftScreen } from "./open-shift-screen";
import { ReportPrintResult, useReportPrint } from "./report-print";
import { ShiftReportView } from "./shift-report-view";
import { ShiftStrip } from "./shift-strip";
import { XReportDialog } from "./x-report-dialog";

const baseHints: Hint[] = [["Ctrl+L", "Switch user"]];
const closingHints: Hint[] = [["Ctrl+Enter", "Close shift"], ["Esc", "Cancel"], ...baseHints];
const reportHints: Hint[] = [["Enter", "Done"], ...baseHints];

type Mode =
  | { name: "main" }
  | { name: "closing" }
  | { name: "orders"; invoiceNo: string | null }
  | { name: "z-report"; report: ShiftReport; warnPaisa: number };

type Dialog =
  | { kind: "cash-move"; moveKind: AddCashMoveInput["kind"] }
  | { kind: "x-report" }
  | null;

interface SellAreaProps {
  openInvoiceNo: string | null;
  onSessionEnded: () => void;
  onHintsChange: (hints: Hint[]) => void;
  onOpenPrinterSettings: () => void;
}

const layerClasses =
  "flex min-h-0 flex-col rounded-tl-300 border-t border-l border-line-card bg-surface";

interface ZReportProps {
  report: ShiftReport;
  warnPaisa: number;
  onDone: () => void;
  onPrinterChanged: () => void;
  onSessionEnded: () => void;
}

function ZReport({ report, warnPaisa, onDone, onPrinterChanged, onSessionEnded }: ZReportProps) {
  const printer = useReportPrint(report.shiftId, onPrinterChanged, onSessionEnded);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-800">
      <div className="mx-auto grid max-w-[720px] gap-500">
        <ShiftReportView
          title={
            <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
              Z-report
            </h1>
          }
          report={report}
          varianceWarnPaisa={warnPaisa}
        />
        <ReportPrintResult
          result={printer.result}
          running={printer.running}
          onRetry={printer.print}
        />
        <div className="flex justify-end gap-200">
          <Button variant="secondary" disabled={printer.running} onClick={printer.print}>
            Print
            <Kbd>Ctrl+P</Kbd>
          </Button>
          <Button autoFocus onClick={onDone}>
            Done
            <Kbd>Enter</Kbd>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SellArea({
  openInvoiceNo,
  onSessionEnded,
  onHintsChange,
  onOpenPrinterSettings,
}: SellAreaProps) {
  const [state, setState] = useState<ShiftState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [mode, setMode] = useState<Mode>(
    openInvoiceNo ? { name: "orders", invoiceNo: openInvoiceNo } : { name: "main" },
  );
  const [billingHints, setBillingHints] = useState<Hint[]>(baseHints);
  const [ordersHints, setOrdersHints] = useState<Hint[]>(baseHints);
  const [billingStep, setBillingStep] = useState<BillingStep>("products");
  const [printerStatus, setPrinterStatus] = useState<PrinterStatus | null>(null);
  const strip = useRef<HTMLDivElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const load = useCallback(() => {
    window.vendora.shifts
      .state()
      .then((next) => {
        setState(next);
        setLoadFailed(false);
      })
      .catch((cause: unknown) => {
        if (isSessionError(cause)) {
          onSessionEnded();
          return;
        }
        setLoadFailed(true);
      });
  }, [onSessionEnded]);

  useEffect(load, [load]);

  const refreshPrinter = useCallback(() => {
    window.vendora.printer
      .status()
      .then(setPrinterStatus)
      .catch((cause: unknown) => {
        if (isSessionError(cause)) onSessionEnded();
      });
  }, [onSessionEnded]);

  useEffect(refreshPrinter, [refreshPrinter]);

  useEffect(() => {
    if (billingStep === "products") refreshPrinter();
  }, [billingStep, refreshPrinter]);

  const shiftOpen = state?.status === "open";

  useEffect(() => {
    onHintsChange(
      mode.name === "closing"
        ? closingHints
        : mode.name === "z-report"
          ? reportHints
          : mode.name === "orders"
            ? ordersHints
            : shiftOpen
              ? billingHints
              : baseHints,
    );
  }, [onHintsChange, shiftOpen, mode.name, billingHints, ordersHints]);

  const openDialog = useCallback((next: NonNullable<Dialog>, opener: HTMLElement | null) => {
    returnFocus.current =
      opener ??
      document.getElementById("scan-field") ??
      strip.current?.querySelector("button") ??
      null;
    setDialog(next);
  }, []);

  useEffect(() => {
    if (!shiftOpen || dialog || mode.name !== "main" || billingStep !== "products") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        setMode({ name: "orders", invoiceNo: null });
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === "F6") {
        event.preventDefault();
        openDialog({ kind: "cash-move", moveKind: "in" }, null);
      } else if (event.key === "F7") {
        event.preventDefault();
        openDialog({ kind: "cash-move", moveKind: "out" }, null);
      } else if (event.key === "F8") {
        event.preventDefault();
        openDialog({ kind: "x-report" }, null);
      } else if (event.key === "F9") {
        event.preventDefault();
        setMode({ name: "closing" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shiftOpen, dialog, mode.name, billingStep, openDialog]);

  const retry = () => {
    setLoadFailed(false);
    load();
  };

  return (
    <main id="panel-sell" role="tabpanel" aria-labelledby="tab-sell" className={layerClasses}>
      {mode.name === "z-report" ? (
        <ZReport
          report={mode.report}
          warnPaisa={mode.warnPaisa}
          onDone={() => {
            setMode({ name: "main" });
            load();
          }}
          onPrinterChanged={refreshPrinter}
          onSessionEnded={onSessionEnded}
        />
      ) : state === null ? (
        <div className="grid flex-1 place-items-center">
          {loadFailed ? (
            <div className="grid justify-items-center gap-200">
              <p role="alert" className="m-0 text-secondary">
                {serviceErrorMessage}
              </p>
              <Button variant="secondary" onClick={retry}>
                Retry
              </Button>
            </div>
          ) : (
            <p className="m-0 text-secondary">Loading…</p>
          )}
        </div>
      ) : state.status === "closed" ? (
        <OpenShiftScreen
          key={state.suggestedFloatPaisa}
          suggestedFloatPaisa={state.suggestedFloatPaisa}
          onChanged={load}
          onSessionEnded={onSessionEnded}
          onPrinterChanged={refreshPrinter}
        />
      ) : mode.name === "orders" ? (
        <OrdersScreen
          active={dialog === null}
          initialInvoiceNo={mode.invoiceNo}
          onBack={() => setMode({ name: "main" })}
          onSessionEnded={onSessionEnded}
          onPrinterChanged={refreshPrinter}
          onHintsChange={setOrdersHints}
          onReturned={() => setMode({ name: "main" })}
        />
      ) : mode.name === "closing" ? (
        <CloseShiftScreen
          shiftId={state.shift.id}
          expectedPaisa={state.report.expectedCashPaisa}
          expectedLabel={state.report.expectedByMethod[0]?.label ?? "Cash"}
          heldBills={state.heldBills}
          varianceWarnPaisa={state.varianceWarnPaisa}
          onCancel={() => setMode({ name: "main" })}
          onClosed={(report) => {
            setMode({ name: "z-report", report, warnPaisa: state.varianceWarnPaisa });
            load();
          }}
          onChanged={() => {
            setMode({ name: "main" });
            load();
          }}
          onSessionEnded={onSessionEnded}
          onPrinterChanged={refreshPrinter}
        />
      ) : (
        <>
          {billingStep === "products" ? (
            <ShiftStrip
              ref={strip}
              openedAt={state.shift.openedAt}
              openedBy={state.shift.openedBy}
              printerStatus={printerStatus}
              onOpenPrinterSettings={onOpenPrinterSettings}
              onOrders={() => setMode({ name: "orders", invoiceNo: null })}
              onCashIn={(opener) => openDialog({ kind: "cash-move", moveKind: "in" }, opener)}
              onCashOut={(opener) => openDialog({ kind: "cash-move", moveKind: "out" }, opener)}
              onXReport={(opener) => openDialog({ kind: "x-report" }, opener)}
              onCloseShift={() => setMode({ name: "closing" })}
            />
          ) : null}
          <BillingScreen
            active={dialog === null}
            onSessionEnded={onSessionEnded}
            onHintsChange={setBillingHints}
            onStepChange={setBillingStep}
            onPrinterChanged={refreshPrinter}
            onOpenPrinterSettings={onOpenPrinterSettings}
          />
        </>
      )}
      {dialog?.kind === "cash-move" ? (
        <CashMoveDialog
          kind={dialog.moveKind}
          returnFocus={returnFocus}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          onSaved={() => {
            load();
            refreshPrinter();
          }}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
      {dialog?.kind === "x-report" && state?.status === "open" ? (
        <XReportDialog
          report={state.report}
          returnFocus={returnFocus}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          onChanged={load}
          onSessionEnded={onSessionEnded}
          onPrinterChanged={refreshPrinter}
        />
      ) : null}
    </main>
  );
}
