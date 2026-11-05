import { useCallback, useEffect, useRef, useState } from "react";

import { printerMessages, type PrintResult } from "@shared/receipt";
import { PrintWarning } from "@renderer/components/print-warning";
import { isSessionError } from "../auth/messages";

interface ReportPrint {
  running: boolean;
  result: PrintResult | null;
  print: () => void;
}

export function useReportPrint(
  shiftId: string,
  onPrinterChanged: () => void,
  onSessionEnded: () => void,
): ReportPrint {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PrintResult | null>(null);
  const busy = useRef(false);
  const callbacks = useRef({ onPrinterChanged, onSessionEnded });
  useEffect(() => {
    callbacks.current = { onPrinterChanged, onSessionEnded };
  });

  const print = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    window.vendora.receipts
      .printShiftReport(shiftId)
      .then(setResult)
      .catch((cause: unknown) => {
        if (isSessionError(cause)) callbacks.current.onSessionEnded();
        setResult({ successful: false, canRetry: true, message: printerMessages.error });
      })
      .finally(() => {
        busy.current = false;
        setRunning(false);
        callbacks.current.onPrinterChanged();
      });
  }, [shiftId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        print();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [print]);

  return { running, result, print };
}

export function ReportPrintResult({
  result,
  running,
  onRetry,
}: {
  result: PrintResult | null;
  running: boolean;
  onRetry: () => void;
}) {
  if (!result) return null;
  if (result.successful) {
    return (
      <p role="status" className="m-0 text-[length:var(--font-size-350)] text-secondary">
        Report sent to the printer.
      </p>
    );
  }
  const noPrinter = result.message === printerMessages.notSetUp;
  return (
    <PrintWarning
      title={noPrinter ? printerMessages.notSetUp : "Report didn't print"}
      message={noPrinter ? undefined : result.message}
      onRetry={result.canRetry ? onRetry : undefined}
      retryDisabled={running}
    />
  );
}
