import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";

interface BillActionsProps {
  hasLines: boolean;
  canPay: boolean;
  miscEnabled: boolean;
  heldCount: number;
  onBillDiscount: () => void;
  onHold: () => void;
  onHeldBills: () => void;
  onMisc: () => void;
  onDiscard: () => void;
  onPay: () => void;
}

export function BillActions({
  hasLines,
  canPay,
  miscEnabled,
  heldCount,
  onBillDiscount,
  onHold,
  onHeldBills,
  onMisc,
  onDiscard,
  onPay,
}: BillActionsProps) {
  return (
    <div className="grid content-end gap-200">
      <Button variant="secondary" disabled={!hasLines} onClick={onBillDiscount}>
        Bill discount
        <Kbd>Shift+F4</Kbd>
      </Button>
      <Button variant="secondary" disabled={!hasLines} onClick={onHold}>
        Hold
        <Kbd>F10</Kbd>
      </Button>
      <Button variant="secondary" onClick={onHeldBills}>
        Held bills
        {heldCount > 0 ? (
          <Badge variant="highlight">
            {heldCount}
            <span className="sr-only"> on hold</span>
          </Badge>
        ) : null}
        <Kbd>F11</Kbd>
      </Button>
      {miscEnabled ? (
        <Button variant="secondary" onClick={onMisc}>
          Misc item
          <Kbd>Ctrl+M</Kbd>
        </Button>
      ) : null}
      <Button variant="secondary" disabled={!hasLines} onClick={onDiscard}>
        Discard
        <Kbd>Ctrl+Del</Kbd>
      </Button>
      <Button size="lg" disabled={!canPay} className="w-full" onClick={onPay}>
        Pay
        <Kbd>F12</Kbd>
      </Button>
    </div>
  );
}
