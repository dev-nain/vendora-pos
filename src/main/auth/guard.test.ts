import { describe, expect, it } from "vitest";
import { UnauthenticatedError } from "./errors";
import { requireSession } from "./guard";
import { createSessionStore, type Session } from "./session";

const sessionFor = (userId: string): Session => ({
  userId,
  storeId: "s1",
  loggedInAt: new Date(0),
});

describe("requireSession", () => {
  it("throws with no session", () => {
    expect(() => requireSession(createSessionStore())).toThrow(UnauthenticatedError);
  });

  it("returns the current session", () => {
    const sessions = createSessionStore();
    const session = sessionFor("u1");
    sessions.start(session);

    expect(requireSession(sessions)).toBe(session);
  });
});
