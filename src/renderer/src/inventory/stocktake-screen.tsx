import { useCallback, useEffect, useRef, useState } from "react";

import type { StocktakeSummary } from "@shared/stocktake";
import { Button } from "@renderer/components/ui/button";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { ErrorLine } from "../users/form-parts";
import { StocktakeCount } from "./stocktake-count";
import { StocktakeStart } from "./stocktake-start";

interface StocktakeScreenProps {
  onSessionEnded: () => void;
}

export function StocktakeScreen({ onSessionEnded }: StocktakeScreenProps) {
  const [current, setCurrent] = useState<StocktakeSummary | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const requestId = useRef(0);

  const reload = useCallback(() => {
    const id = ++requestId.current;
    window.vendora.stocktake
      .current()
      .then((summary) => {
        if (id !== requestId.current) return;
        setCurrent(summary);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        if (isSessionError(cause)) onSessionEnded();
        else setError(serviceErrorMessage);
      });
  }, [onSessionEnded]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (error) {
    return (
      <div className="flex items-center gap-300">
        <ErrorLine>{error}</ErrorLine>
        <Button variant="secondary" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }
  if (current === undefined) return <p className="m-0 text-secondary">Loading…</p>;

  if (current === null) {
    return (
      <StocktakeStart
        cancelled={cancelled}
        onStarted={(stocktake) => {
          setCancelled(false);
          setCurrent(stocktake);
        }}
        onAlreadyOpen={reload}
        onSessionEnded={onSessionEnded}
      />
    );
  }

  return (
    <StocktakeCount
      stocktake={current}
      onClosed={reload}
      onCancelled={() => {
        setCancelled(true);
        setCurrent(null);
      }}
      onSessionEnded={onSessionEnded}
    />
  );
}
