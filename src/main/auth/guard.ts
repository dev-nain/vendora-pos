import { SessionLockedError, UnauthenticatedError } from "./errors";
import { requirePermission, type Permission } from "./policy";
import type { Session, SessionStore } from "./session";

export function requireSession(sessions: SessionStore): Session {
  const session = sessions.current();
  if (!session) throw new UnauthenticatedError();
  return session;
}

export function requireUnlockedSession(sessions: SessionStore): Session {
  const session = requireSession(sessions);
  if (sessions.isLocked()) throw new SessionLockedError();
  return session;
}

export function requireSessionPermission(sessions: SessionStore, permission: Permission): Session {
  const session = requireUnlockedSession(sessions);
  requirePermission(session, permission);
  return session;
}
