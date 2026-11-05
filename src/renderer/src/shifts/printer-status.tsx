import { PrinterIcon } from "lucide-react";

import { printerMessages, type PrinterStatus } from "@shared/receipt";

interface PrinterStatusItemProps {
  status: PrinterStatus | null;
  onOpen: () => void;
}

export function PrinterStatusItem({ status, onOpen }: PrinterStatusItemProps) {
  if (!status || status.state === "ok") return null;
  const text = status.state === "not-set-up" ? printerMessages.notSetUp : printerMessages.error;
  return (
    <button
      type="button"
      aria-label={`${text}. Open printer settings`}
      onClick={onOpen}
      className="inline-flex min-h-[var(--height-control-md)] items-center gap-200 rounded-100 bg-fill-warning-secondary px-300 text-[length:var(--font-size-350)] font-semibold whitespace-nowrap text-warning outline-none focus-visible:shadow-focus"
    >
      <PrinterIcon aria-hidden="true" size={16} strokeWidth={2} className="text-icon-warning" />
      {text}
    </button>
  );
}
