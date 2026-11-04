import { CircleCheckIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import type { CompletedSale } from "@shared/checkout";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import { formatRupees } from "../lib/money";
import { createBurstDetector } from "./scan-burst";

interface ReceiptScreenProps {
  sale: CompletedSale;
  active: boolean;
  onNewBill: (scannedCode?: string) => void;
}

function Figure({ label, paisa }: { label: string; paisa: number }) {
  return (
    <div className="grid gap-100">
      <dt className="text-[length:var(--font-size-450)] text-secondary">{label}</dt>
      <dd className="m-0 font-display text-[length:var(--font-size-1400)] leading-[var(--line-height-tight)] font-semibold text-foreground tabular-nums">
        {formatRupees(paisa)}
      </dd>
    </div>
  );
}

export function ReceiptScreen({ sale, active, onNewBill }: ReceiptScreenProps) {
  const newBill = useRef(onNewBill);
  useEffect(() => {
    newBill.current = onNewBill;
  });

  useEffect(() => {
    if (!active) return;
    const detector = createBurstDetector();
    const onKeyDown = (event: KeyboardEvent) => {
      const result = detector.feed(event.key, event.timeStamp);
      if (result.scan === null) return;
      event.preventDefault();
      event.stopPropagation();
      newBill.current(result.scan);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active]);

  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-600">
      <div className="grid w-full max-w-[960px] gap-600">
        <div className="grid gap-200">
          <div className="flex items-center gap-300">
            <CircleCheckIcon
              aria-hidden="true"
              size={24}
              strokeWidth={2}
              className="text-[var(--color-icon-success)]"
            />
            <h1 className="m-0 text-[length:var(--font-size-700)] font-semibold text-foreground">
              Sale saved
            </h1>
          </div>
          <p className="m-0 text-[length:var(--font-size-450)] text-secondary tabular-nums">
            Invoice {sale.invoiceNo}
          </p>
        </div>
        <dl className="m-0 grid grid-cols-3 gap-600">
          <Figure label="Total" paisa={sale.totalPaisa} />
          <Figure label="Paid" paisa={sale.totalPaisa + sale.changePaisa} />
          <Figure label="Change" paisa={sale.changePaisa} />
        </dl>
        <div>
          <Button size="lg" autoFocus onClick={() => onNewBill()}>
            New bill
            <Kbd>Enter</Kbd>
          </Button>
        </div>
      </div>
    </div>
  );
}
