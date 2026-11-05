import { useState, type RefObject } from "react";

import type { CashMove, ShiftReport } from "@shared/shifts";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Kbd } from "@renderer/components/ui/kbd";
import { DeleteCashMoveDialog } from "./delete-cash-move-dialog";
import { ReportPrintResult, useReportPrint } from "./report-print";
import { ShiftReportView } from "./shift-report-view";

interface XReportDialogProps {
  report: ShiftReport;
  returnFocus: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  onSessionEnded: () => void;
  onPrinterChanged: () => void;
}

export function XReportDialog({
  report,
  returnFocus,
  onOpenChange,
  onChanged,
  onSessionEnded,
  onPrinterChanged,
}: XReportDialogProps) {
  const printer = useReportPrint(report.shiftId, onPrinterChanged, onSessionEnded);
  const [deleting, setDeleting] = useState<{ move: CashMove; opener: HTMLElement } | null>(null);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        finalFocus={returnFocus}
        className="flex max-h-[calc(100vh-32px)] w-[min(720px,calc(100vw-32px))] flex-col"
      >
        <DialogHeader className="min-h-0 flex-1 overflow-y-auto">
          <ShiftReportView
            title={<DialogTitle className="pr-0">X-report</DialogTitle>}
            report={report}
            onDeleteMove={(move, opener) => setDeleting({ move, opener })}
          />
        </DialogHeader>
        <DialogFooter className="grid-flow-row justify-items-end">
          <div className="w-full">
            <ReportPrintResult
              result={printer.result}
              running={printer.running}
              onRetry={printer.print}
            />
          </div>
          <div className="flex gap-200">
            <Button variant="secondary" disabled={printer.running} onClick={printer.print}>
              Print
              <Kbd>Ctrl+P</Kbd>
            </Button>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Close
              <Kbd>Esc</Kbd>
            </Button>
          </div>
        </DialogFooter>
        {deleting ? (
          <DeleteCashMoveDialog
            move={deleting.move}
            opener={deleting.opener}
            onOpenChange={(open) => {
              if (!open) setDeleting(null);
            }}
            onDeleted={onChanged}
            onSessionEnded={onSessionEnded}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
