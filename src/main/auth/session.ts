import type { UserRole } from "../db/schema";

export interface Session {
  userId: string;
  role: UserRole;
  storeId: string;
  loggedInAt: Date;
}

export function createSessionStore() {
  let session: Session | null = null;

  return {
    current: (): Session | null => session,
    start(next: Session): void {
      session = next;
    },
    end(): void {
      session = null;
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
