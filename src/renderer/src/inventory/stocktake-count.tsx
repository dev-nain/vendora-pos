import { useRef, useState } from "react";

import type { StocktakeSummary } from "@shared/stocktake";
import { Button } from "@renderer/components/ui/button";
import { formatDateTime } from "../lib/date-time";
import { CancelStocktakeDialog } from "./cancel-stocktake-dialog";

interface StocktakeCountProps {
  stocktake: StocktakeSummary;
  onCancelled: () => void;
  onSessionEnded: () => void;
}

export function StocktakeCount({ stocktake, onCancelled, onSessionEnded }: StocktakeCountProps) {
  const [cancelling, setCancelling] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const scopeText =
    stocktake.scope === "full" ? "Full count" : `Category: ${stocktake.categoryName ?? ""}`;

  return (
    <div className="flex flex-col gap-400">
      <div className="flex items-start justify-between gap-400">
        <div className="grid gap-100">
          <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
            Stocktake
          </h1>
          <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
            {scopeText}. Started {formatDateTime(stocktake.startedAt)} by {stocktake.startedByName}.
            Saved as you go.
          </p>
          <p className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground tabular-nums">
            {stocktake.countedCount} of {stocktake.lineCount} counted
          </p>
        </div>
        <Button
          ref={cancelRef}
          type="button"
          variant="secondary"
          onClick={() => setCancelling(true)}
        >
          Cancel count
        </Button>
      </div>
      {cancelling ? (
        <CancelStocktakeDialog
          stocktakeId={stocktake.id}
          countedCount={stocktake.countedCount}
          returnFocus={cancelRef}
          onCancelled={onCancelled}
          onKeep={() => setCancelling(false)}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
    </div>
  );
}
