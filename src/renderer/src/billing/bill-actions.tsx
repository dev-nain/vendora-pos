import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";

export function BillActions() {
  return (
    <div className="grid content-end gap-200">
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
