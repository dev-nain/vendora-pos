import type { UserRole } from "../db/schema";

export interface Session {
  userId: string;
  role: UserRole;
  storeId: string;
  loggedInAt: Date;
}

export type SessionEvent =
  | { type: "started"; session: Session }
  | { type: "locked"; session: Session }
  | { type: "ended" }
  | { type: "user-changed"; previousUserId: string; userId: string };

export type SessionListener = (event: SessionEvent) => void;

export function createSessionStore() {
  let session: Session | null = null;
  let locked = false;
  const listeners: SessionListener[] = [];

  const emit = (event: SessionEvent) => {
    for (const listener of listeners) listener(event);
  };

  return {
    current: (): Session | null => session,
    isLocked: (): boolean => locked,
    start(next: Session): void {
      const previous = session;
      session = next;
      locked = false;
      emit({ type: "started", session: next });
      if (previous && previous.userId !== next.userId) {
        emit({ type: "user-changed", previousUserId: previous.userId, userId: next.userId });
      }
    },
    lock(): void {
      if (!session || locked) return;
      locked = true;
      emit({ type: "locked", session });
    },
    end(): void {
      const hadSession = session !== null;
      session = null;
      locked = false;
      if (hadSession) emit({ type: "ended" });
    },
    onChange(listener: SessionListener): () => void {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
