import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";

interface BillActionsProps {
  hasLines: boolean;
  miscEnabled: boolean;
  onBillDiscount: () => void;
  onMisc: () => void;
}

export function BillActions({ hasLines, miscEnabled, onBillDiscount, onMisc }: BillActionsProps) {
  return (
    <div className="grid content-end gap-200">
      <Button variant="secondary" disabled={!hasLines} onClick={onBillDiscount}>
        Bill discount
        <Kbd>Shift+F4</Kbd>
      </Button>
      {miscEnabled ? (
        <Button variant="secondary" onClick={onMisc}>
          Misc item
          <Kbd>Ctrl+M</Kbd>
        </Button>
      ) : null}
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
