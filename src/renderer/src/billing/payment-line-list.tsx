import { XIcon } from "lucide-react";

import { paymentMethodLabels, type PaymentMethod } from "@shared/checkout";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { cn } from "@renderer/lib/utils";
import type { PaymentLine } from "./payment-lines";

export const amountInputId = (method: PaymentMethod) => `pay-amount-${method}`;
export const referenceInputId = (method: PaymentMethod) => `pay-reference-${method}`;

interface PaymentLineListProps {
  lines: PaymentLine[];
  selected: PaymentMethod | null;
  onSelect: (method: PaymentMethod) => void;
  onActivate: (method: PaymentMethod) => void;
  onAmountChange: (method: PaymentMethod, text: string) => void;
  onReferenceChange: (method: PaymentMethod, text: string) => void;
  onRemove: (method: PaymentMethod) => void;
}

export function PaymentLineList({
  lines,
  selected,
  onSelect,
  onActivate,
  onAmountChange,
  onReferenceChange,
  onRemove,
}: PaymentLineListProps) {
  if (lines.length === 0) {
    return <p className="m-0 text-secondary">Choose a payment method. F2 is Cash.</p>;
  }
  return (
    <ul aria-label="Payment lines" className="m-0 grid list-none gap-100 p-0">
      {lines.map((line) => {
        const label = paymentMethodLabels[line.method];
        const isSelected = line.method === selected;
        return (
          <li
            key={line.method}
            onClick={() => onActivate(line.method)}
            className={cn(
              "flex min-h-[var(--height-row)] items-center gap-300 rounded-200 px-300 py-100",
              isSelected ? "selection-pill" : "hover:bg-surface-hover",
            )}
          >
            <span className="w-[120px] shrink-0 text-[length:var(--font-size-400)] font-semibold text-foreground">
              {label}
            </span>
            <div className="min-w-0 flex-1">
              {line.method === "cash" ? null : (
                <Input
                  id={referenceInputId(line.method)}
                  aria-label={`${label} reference`}
                  placeholder="Reference (optional)"
                  maxLength={64}
                  value={line.reference}
                  onClick={(event) => event.stopPropagation()}
                  onFocus={() => onSelect(line.method)}
                  onChange={(event) => onReferenceChange(line.method, event.target.value)}
                />
              )}
            </div>
            <Input
              id={amountInputId(line.method)}
              aria-label={`${label} amount`}
              inputMode="decimal"
              autoComplete="off"
              value={line.amount.text}
              className="w-[160px] shrink-0 text-right tabular-nums"
              onClick={(event) => event.stopPropagation()}
              onFocus={(event) => {
                onSelect(line.method);
                event.currentTarget.select();
              }}
              onChange={(event) => onAmountChange(line.method, event.target.value)}
            />
            <Button
              variant="ghost"
              aria-label={`Remove ${label} line`}
              className="min-h-[44px] min-w-[44px] shrink-0 px-0"
              onClick={(event) => {
                event.stopPropagation();
                onRemove(line.method);
              }}
            >
              <XIcon aria-hidden="true" size={16} strokeWidth={2} />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
