import { useEffect } from "react";

import { createActivityReporter } from "./activity-report";

const activityEvents = ["keydown", "pointerdown", "pointermove", "wheel"] as const;

export function useActivityReport(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const touch = createActivityReporter(() => window.vendora.activity.report());
    const options = { capture: true, passive: true } as const;
    for (const name of activityEvents) window.addEventListener(name, touch, options);
    return () => {
      for (const name of activityEvents) window.removeEventListener(name, touch, options);
    };
  }, [enabled]);
}
