import { useCallback, useEffect, useRef, useState } from "react";

import type { StocktakeSummary } from "@shared/stocktake";
import { Button } from "@renderer/components/ui/button";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { ErrorLine } from "../users/form-parts";
import { StocktakeCount } from "./stocktake-count";
import { StocktakeReviewScreen } from "./stocktake-review";
import { StocktakeStart } from "./stocktake-start";

interface StocktakeScreenProps {
  onSessionEnded: () => void;
}

export function StocktakeScreen({ onSessionEnded }: StocktakeScreenProps) {
  const [current, setCurrent] = useState<StocktakeSummary | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const requestId = useRef(0);

  const reload = useCallback(
    (afterLoad?: () => void) => {
      const id = ++requestId.current;
      window.vendora.stocktake
        .current()
        .then((summary) => {
          if (id !== requestId.current) return;
          setCurrent(summary);
          setError(null);
          afterLoad?.();
        })
        .catch((cause: unknown) => {
          if (id !== requestId.current) return;
          if (isSessionError(cause)) onSessionEnded();
          else setError(serviceErrorMessage);
        });
    },
    [onSessionEnded],
  );

  const reloadCurrent = useCallback(() => reload(), [reload]);
  const leaveReview = useCallback(() => reload(() => setReviewing(null)), [reload]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (error) {
    return (
      <div className="flex items-center gap-300">
        <ErrorLine>{error}</ErrorLine>
        <Button variant="secondary" onClick={() => reload()}>
          Try again
        </Button>
      </div>
    );
  }
  if (current === undefined) return <p className="m-0 text-secondary">Loading…</p>;

  if (reviewing) {
    return (
      <StocktakeReviewScreen
        stocktakeId={reviewing}
        onBack={leaveReview}
        onSessionEnded={onSessionEnded}
      />
    );
  }

  if (current === null) {
    return (
      <StocktakeStart
        cancelled={cancelled}
        onStarted={(stocktake) => {
          setCancelled(false);
          setCurrent(stocktake);
        }}
        onAlreadyOpen={reloadCurrent}
        onSessionEnded={onSessionEnded}
      />
    );
  }

  return (
    <StocktakeCount
      stocktake={current}
      onClosed={reloadCurrent}
      onReview={() => reload(() => setReviewing(current.id))}
      onCancelled={() => {
        setCancelled(true);
        setCurrent(null);
      }}
      onSessionEnded={onSessionEnded}
    />
  );
}
