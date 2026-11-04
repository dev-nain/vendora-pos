import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";

interface BillActionsProps {
  hasLines: boolean;
  miscEnabled: boolean;
  heldCount: number;
  onBillDiscount: () => void;
  onHold: () => void;
  onHeldBills: () => void;
  onMisc: () => void;
  onDiscard: () => void;
}

export function BillActions({
  hasLines,
  miscEnabled,
  heldCount,
  onBillDiscount,
  onHold,
  onHeldBills,
  onMisc,
  onDiscard,
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
      <div className="grid gap-100">
        <Button size="lg" disabled aria-describedby="pay-caption" className="w-full">
          Pay
          <Kbd>F12</Kbd>
        </Button>
        <p
          id="pay-caption"
          className="m-0 text-center text-[length:var(--font-size-300)] text-tertiary"
        >
          Payment isn't set up yet
        </p>
      </div>
    </div>
  );
}
