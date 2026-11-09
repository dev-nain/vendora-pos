import { CheckIcon } from "lucide-react";

import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import { cn } from "@renderer/lib/utils";

interface BillActionsProps {
  hasLines: boolean;
  canPay: boolean;
  canReturn: boolean;
  returnActive: boolean;
  miscEnabled: boolean;
  heldCount: number;
  onBillDiscount: () => void;
  onHold: () => void;
  onHeldBills: () => void;
  onMisc: () => void;
  onReturn: () => void;
  onDiscard: () => void;
  onPay: () => void;
}

const actionClasses = "w-full min-w-0 px-200";

export function BillActions({
  hasLines,
  canPay,
  canReturn,
  returnActive,
  miscEnabled,
  heldCount,
  onBillDiscount,
  onHold,
  onHeldBills,
  onMisc,
  onReturn,
  onDiscard,
  onPay,
}: BillActionsProps) {
  return (
    <div className="grid h-full grid-cols-2 grid-rows-[repeat(3,minmax(var(--height-control-md),1fr))_var(--height-control-lg)] gap-200">
      <Button
        variant="secondary"
        className={actionClasses}
        disabled={!hasLines}
        onClick={onBillDiscount}
      >
        Bill discount
      </Button>
      <Button
        variant="secondary"
        className={actionClasses}
        disabled={!hasLines}
        onClick={onDiscard}
      >
        Discard
      </Button>
      {miscEnabled ? (
        <Button variant="secondary" className={actionClasses} onClick={onMisc}>
          Misc item
        </Button>
      ) : null}
      <Button
        variant="secondary"
        aria-pressed={returnActive}
        className={cn(
          actionClasses,
          !miscEnabled && "col-span-2",
          returnActive && "bg-surface-selected",
        )}
        disabled={!canReturn}
        onClick={onReturn}
      >
        {returnActive ? <CheckIcon aria-hidden="true" size={14} strokeWidth={2} /> : null}
        Return
      </Button>
      <Button variant="secondary" className={actionClasses} disabled={!hasLines} onClick={onHold}>
        Hold
      </Button>
      <Button variant="secondary" className={actionClasses} onClick={onHeldBills}>
        Held bills
        {heldCount > 0 ? (
          <Badge variant="highlight">
            {heldCount}
            <span className="sr-only"> on hold</span>
          </Badge>
        ) : null}
      </Button>
      <Button size="lg" disabled={!canPay} className="col-span-2 w-full" onClick={onPay}>
        Pay
        <Kbd>F12</Kbd>
      </Button>
    </div>
  );
}
