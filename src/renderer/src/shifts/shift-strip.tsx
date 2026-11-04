import { CircleCheckIcon } from "lucide-react";
import type { Ref } from "react";

import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import type { PrinterStatus } from "@shared/receipt";
import { formatTime } from "../lib/date-time";
import { PrinterStatusItem } from "./printer-status";

interface ShiftStripProps {
  ref?: Ref<HTMLDivElement>;
  openedAt: string;
  openedBy: string;
  printerStatus: PrinterStatus | null;
  onOpenPrinterSettings: () => void;
  onCashIn: (opener: HTMLElement | null) => void;
  onCashOut: (opener: HTMLElement | null) => void;
  onXReport: (opener: HTMLElement | null) => void;
  onCloseShift: () => void;
}

export function ShiftStrip({
  ref,
  openedAt,
  openedBy,
  printerStatus,
  onOpenPrinterSettings,
  onCashIn,
  onCashOut,
  onXReport,
  onCloseShift,
}: ShiftStripProps) {
  return (
    <div
      ref={ref}
      className="flex min-h-[var(--height-row)] items-center justify-between gap-400 border-b border-line px-600"
    >
      <div className="flex items-center gap-200 text-[length:var(--font-size-350)] text-foreground">
        <Badge variant="success">
          <CircleCheckIcon aria-hidden="true" strokeWidth={2} />
          Shift open
        </Badge>
        <span className="text-[length:var(--font-size-300)] text-tertiary">
          since {formatTime(openedAt)}
        </span>
        <span>{openedBy}</span>
      </div>
      <div className="flex items-center gap-200">
        <Button variant="secondary" onClick={(event) => onCashIn(event.currentTarget)}>
          Cash in
          <Kbd>F6</Kbd>
        </Button>
        <Button variant="secondary" onClick={(event) => onCashOut(event.currentTarget)}>
          Cash out
          <Kbd>F7</Kbd>
        </Button>
        <Button variant="secondary" onClick={(event) => onXReport(event.currentTarget)}>
          X-report
          <Kbd>F8</Kbd>
        </Button>
        <Button variant="secondary" onClick={onCloseShift}>
          Close shift
          <Kbd>F9</Kbd>
        </Button>
        <PrinterStatusItem status={printerStatus} onOpen={onOpenPrinterSettings} />
      </div>
    </div>
  );
}
