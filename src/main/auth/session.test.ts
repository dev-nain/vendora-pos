import { describe, expect, it } from "vitest";
import { createSessionStore, type Session } from "./session";

const sessionFor = (userId: string): Session => ({
  userId,
  role: "owner",
  storeId: "s1",
  loggedInAt: new Date(0),
});

describe("session store", () => {
  it("starts with no session", () => {
    expect(createSessionStore().current()).toBeNull();
  });

  it("holds, replaces and clears the session", () => {
    const sessions = createSessionStore();

    sessions.start(sessionFor("u1"));
    expect(sessions.current()?.userId).toBe("u1");

    sessions.start(sessionFor("u2"));
    expect(sessions.current()?.userId).toBe("u2");

    sessions.end();
    expect(sessions.current()).toBeNull();
  });

  it("exposes only current, start and end", () => {
    expect(Object.keys(createSessionStore()).toSorted()).toEqual(["current", "end", "start"]);
  });
});
