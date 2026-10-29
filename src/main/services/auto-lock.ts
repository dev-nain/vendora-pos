import type { Session, SessionStore } from "../auth/session";

interface AutoLockDeps {
  sessions: SessionStore;
  readMinutes: (storeId: string) => number | null;
}

const MS_PER_MINUTE = 60_000;

export function createAutoLock({ sessions, readMinutes }: AutoLockDeps) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let minutes: number | null = null;

  function clear(): void {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function arm(session: Session): void {
    clear();
    if (minutes === null) return;
    timer = setTimeout(() => {
      timer = null;
      if (sessions.current() === session && !sessions.isLocked()) sessions.lock();
    }, minutes * MS_PER_MINUTE);
  }

  function load(session: Session): void {
    minutes = readMinutes(session.storeId);
    arm(session);
  }

  const unsubscribe = sessions.onChange((event) => {
    if (event.type === "started") load(event.session);
    else if (event.type === "locked" || event.type === "ended") clear();
  });

  function reportActivity(): void {
    const session = sessions.current();
    if (!session || sessions.isLocked() || minutes === null) return;
    arm(session);
  }

  function refresh(): void {
    const session = sessions.current();
    if (!session || sessions.isLocked()) return;
    load(session);
  }

  function dispose(): void {
    clear();
    unsubscribe();
  }

  return { reportActivity, refresh, dispose };
}

export type AutoLock = ReturnType<typeof createAutoLock>;
