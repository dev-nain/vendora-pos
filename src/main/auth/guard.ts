import { UnauthenticatedError } from "./errors";
import type { Session, SessionStore } from "./session";

export function requireSession(sessions: SessionStore): Session {
  const session = sessions.current();
  if (!session) throw new UnauthenticatedError();
  return session;
}
