import { describe, expect, it } from "vitest";
import { createSessionStore, type Session, type SessionEvent } from "./session";

const sessionFor = (userId = "u1"): Session => ({
  userId,
  role: "owner",
  storeId: "s1",
  loggedInAt: new Date(0),
});

const record = (sessions: ReturnType<typeof createSessionStore>) => {
  const events: SessionEvent[] = [];
  sessions.onChange((event) => events.push(event));
  return events;
};

describe("session lock", () => {
  it("does nothing without a session", () => {
    const sessions = createSessionStore();
    const events = record(sessions);

    sessions.lock();

    expect(sessions.isLocked()).toBe(false);
    expect(events).toEqual([]);
  });

  it("locks, and start or end clear the lock", () => {
    const sessions = createSessionStore();
    sessions.start(sessionFor());
    sessions.lock();
    expect(sessions.isLocked()).toBe(true);

    sessions.start(sessionFor());
    expect(sessions.isLocked()).toBe(false);

    sessions.lock();
    sessions.end();
    expect(sessions.isLocked()).toBe(false);
  });
});

describe("session events", () => {
  it("emits started, locked and ended once each", () => {
    const sessions = createSessionStore();
    const events = record(sessions);
    const session = sessionFor();

    sessions.start(session);
    sessions.lock();
    sessions.lock();
    sessions.end();
    sessions.end();

    expect(events).toEqual([
      { type: "started", session },
      { type: "locked", session },
      { type: "ended" },
    ]);
  });

  it("emits user-changed after started only when a different user starts", () => {
    const sessions = createSessionStore();
    const events = record(sessions);

    sessions.start(sessionFor("u1"));
    sessions.lock();
    sessions.start(sessionFor("u1"));
    expect(events.some((event) => event.type === "user-changed")).toBe(false);

    sessions.lock();
    sessions.start(sessionFor("u2"));
    expect(events.at(-2)?.type).toBe("started");
    expect(events.at(-1)).toEqual({ type: "user-changed", previousUserId: "u1", userId: "u2" });
  });

  it("does not emit user-changed after a logout", () => {
    const sessions = createSessionStore();
    sessions.start(sessionFor("u1"));
    sessions.end();
    const events = record(sessions);

    sessions.start(sessionFor("u2"));

    expect(events.map((event) => event.type)).toEqual(["started"]);
  });

  it("keeps state when a listener throws, and stops after unsubscribe", () => {
    const sessions = createSessionStore();
    const unsubscribe = sessions.onChange(() => {
      throw new Error("boom");
    });

    expect(() => sessions.start(sessionFor())).toThrow("boom");
    expect(sessions.current()?.userId).toBe("u1");

    unsubscribe();
    expect(() => sessions.lock()).not.toThrow();
    expect(sessions.isLocked()).toBe(true);
  });
});
