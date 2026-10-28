import { useCallback, useEffect, useState } from "react";
import { remainingMs } from "./cooldown";

export interface PinCooldown {
  remainingMs: number;
  active: boolean;
  ended: boolean;
  start: (userId: string, retryAfterMs: number) => void;
  clear: (userId: string) => void;
}

export function usePinCooldown(userId: string | null): PinCooldown {
  const [deadlines, setDeadlines] = useState<ReadonlyMap<string, number>>(new Map());
  const [now, setNow] = useState(() => Date.now());

  const deadline = userId === null ? undefined : deadlines.get(userId);
  const remaining = deadline === undefined ? 0 : remainingMs(deadline, now);
  const active = remaining > 0;
  const ended = deadline !== undefined && !active;

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  const start = useCallback((id: string, retryAfterMs: number) => {
    const at = Date.now();
    setNow(at);
    setDeadlines((previous) => new Map(previous).set(id, at + retryAfterMs));
  }, []);

  const clear = useCallback((id: string) => {
    setDeadlines((previous) => {
      const next = new Map(previous);
      next.delete(id);
      return next;
    });
  }, []);

  return { remainingMs: remaining, active, ended, start, clear };
}
