import { useEffect, useRef } from "react";

import type { CountPhase } from "@shared/receipt";

export function useCountDrawer(phase: CountPhase, onPrinterChanged: () => void): void {
  const kicked = useRef(false);
  const changed = useRef(onPrinterChanged);
  useEffect(() => {
    changed.current = onPrinterChanged;
  });

  useEffect(() => {
    if (kicked.current) return;
    kicked.current = true;
    window.vendora.printer
      .openDrawerForCount(phase)
      .catch(() => undefined)
      .finally(() => changed.current());
  }, [phase]);
}
