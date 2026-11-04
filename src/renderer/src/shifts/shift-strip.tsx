import { CircleCheckIcon } from "lucide-react";

import { Badge } from "@renderer/components/ui/badge";
import { formatTime } from "../lib/date-time";

interface ShiftStripProps {
  openedAt: string;
  openedBy: string;
}

export function ShiftStrip({ openedAt, openedBy }: ShiftStripProps) {
  return (
    <div className="flex min-h-[var(--height-row)] items-center justify-between gap-400 border-b border-line px-600">
      <div className="flex items-center gap-200 text-[length:var(--font-size-350)] text-foreground">
        <Badge variant="success">
          <CircleCheckIcon aria-hidden="true" strokeWidth={2} />
          Shift open
        </Badge>
        <span className="text-[length:var(--font-size-300)] text-tertiary">
          since {formatTime(openedAt)}
        </span>
        <span>{openedBy}</span>
      </div>
    </div>
  );
}
