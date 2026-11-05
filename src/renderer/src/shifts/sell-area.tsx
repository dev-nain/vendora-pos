import { useCallback, useEffect, useState } from "react";

import type { ShiftState } from "@shared/shifts";
import { Button } from "@renderer/components/ui/button";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import type { Hint } from "../shell/hint-bar";
import { OpenShiftScreen } from "./open-shift-screen";
import { ShiftStrip } from "./shift-strip";

const baseHints: Hint[] = [["Ctrl+L", "Switch user"]];

interface SellAreaProps {
  onSessionEnded: () => void;
  onHintsChange: (hints: Hint[]) => void;
}

const layerClasses =
  "flex min-h-0 flex-col rounded-tl-300 border-t border-l border-line-card bg-surface";

export function SellArea({ onSessionEnded, onHintsChange }: SellAreaProps) {
  const [state, setState] = useState<ShiftState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

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

  useEffect(() => {
    onHintsChange(baseHints);
  }, [onHintsChange]);

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
          <ShiftStrip openedAt={state.shift.openedAt} openedBy={state.shift.openedBy} />
          <div className="grid flex-1 place-items-center text-secondary">
            <p className="m-0">Checkout isn't set up yet.</p>
          </div>
        </>
      )}
    </main>
  );
}
