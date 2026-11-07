import { TriangleAlertIcon } from "lucide-react";

import type { SecondCopyState } from "./use-second-copy-status";
import { secondCopyNotice } from "./second-copy-status";

export function SecondCopyNotice({ state }: { state: SecondCopyState }) {
  const text = state.name === "ready" ? secondCopyNotice(state.status) : null;
  if (text === null) return null;
  return (
    <p
      role="status"
      className="m-0 mb-400 flex items-center gap-200 rounded-100 border border-line-warning bg-surface-warning px-400 py-200 text-[length:var(--font-size-350)] text-warning"
    >
      <TriangleAlertIcon
        aria-hidden="true"
        size={16}
        strokeWidth={2}
        className="shrink-0 text-icon-warning"
      />
      {text}
    </p>
  );
}
