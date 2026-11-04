import { useCallback, useEffect, useRef, useState } from "react";

import type { AddCashMoveInput, ShiftState } from "@shared/shifts";
import { Button } from "@renderer/components/ui/button";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import type { Hint } from "../shell/hint-bar";
import { CashMoveDialog } from "./cash-move-dialog";
import { OpenShiftScreen } from "./open-shift-screen";
import { ShiftStrip } from "./shift-strip";
import { XReportDialog } from "./x-report-dialog";

const baseHints: Hint[] = [["Ctrl+L", "Switch user"]];
const openHints: Hint[] = [["F6", "Cash in"], ["F7", "Cash out"], ["F8", "X-report"], ...baseHints];

type Dialog =
  | { kind: "cash-move"; moveKind: AddCashMoveInput["kind"] }
  | { kind: "x-report" }
  | null;

interface SellAreaProps {
  onSessionEnded: () => void;
  onHintsChange: (hints: Hint[]) => void;
}

const layerClasses =
  "flex min-h-0 flex-col rounded-tl-300 border-t border-l border-line-card bg-surface";

export function SellArea({ onSessionEnded, onHintsChange }: SellAreaProps) {
  const [state, setState] = useState<ShiftState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
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

  const shiftOpen = state?.status === "open";

  useEffect(() => {
    onHintsChange(shiftOpen ? openHints : baseHints);
  }, [onHintsChange, shiftOpen]);

  const openDialog = useCallback((next: NonNullable<Dialog>, opener: HTMLElement | null) => {
    returnFocus.current = opener ?? strip.current?.querySelector("button") ?? null;
    setDialog(next);
  }, []);

  useEffect(() => {
    if (!shiftOpen || dialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
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
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shiftOpen, dialog, openDialog]);

  const retry = () => {
    setLoadFailed(false);
    load();
  };

  return (
    <main id="panel-sell" role="tabpanel" aria-labelledby="tab-sell" className={layerClasses}>
      {state === null ? (
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
        />
      ) : (
        <>
          <ShiftStrip
            ref={strip}
            openedAt={state.shift.openedAt}
            openedBy={state.shift.openedBy}
            onCashIn={(opener) => openDialog({ kind: "cash-move", moveKind: "in" }, opener)}
            onCashOut={(opener) => openDialog({ kind: "cash-move", moveKind: "out" }, opener)}
            onXReport={(opener) => openDialog({ kind: "x-report" }, opener)}
          />
          <div className="grid flex-1 place-items-center text-secondary">
            <p className="m-0">Checkout isn't set up yet.</p>
          </div>
        </>
      )}
      {dialog?.kind === "cash-move" ? (
        <CashMoveDialog
          kind={dialog.moveKind}
          returnFocus={returnFocus}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          onSaved={load}
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
        />
      ) : null}
    </main>
  );
}
