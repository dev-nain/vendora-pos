import { PrinterIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";

interface PrintWarningProps {
  title: string;
  message?: string | undefined;
  hint?: string | undefined;
  onRetry?: (() => void) | undefined;
  retryDisabled?: boolean | undefined;
  action?: ReactNode;
}

export function PrintWarning({
  title,
  message,
  hint,
  onRetry,
  retryDisabled,
  action,
}: PrintWarningProps) {
  return (
    <div
      role="alert"
      className="flex items-start gap-300 rounded-200 border border-line-warning bg-surface-warning p-300 text-[length:var(--font-size-350)]"
    >
      <PrinterIcon
        aria-hidden="true"
        size={20}
        strokeWidth={2}
        className="mt-050 shrink-0 text-icon-warning"
      />
      <div className="grid min-w-0 flex-1 gap-050">
        <p className="m-0 font-semibold text-foreground">{title}</p>
        {message ? <p className="m-0 text-secondary">{message}</p> : null}
        {hint ? <p className="m-0 text-secondary">{hint}</p> : null}
      </div>
      {onRetry ? (
        <Button variant="secondary" disabled={retryDisabled} onClick={onRetry}>
          Retry
          <Kbd>Ctrl+P</Kbd>
        </Button>
      ) : null}
      {action}
    </div>
  );
}
