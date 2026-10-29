import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionStore, type Session, type SessionStore } from "../auth/session";
import { createAutoLock } from "./auto-lock";

const sessionFor = (userId: string): Session => ({
  userId,
  role: "cashier",
  storeId: "s1",
  loggedInAt: new Date(0),
});

const MIN = 60_000;

describe("createAutoLock", () => {
  let sessions: SessionStore;
  let minutes: number | null;
  let reads: number;
  let autoLock: ReturnType<typeof createAutoLock>;

  beforeEach(() => {
    vi.useFakeTimers();
    sessions = createSessionStore();
    minutes = 5;
    reads = 0;
    autoLock = createAutoLock({
      sessions,
      readMinutes: () => {
        reads += 1;
        return minutes;
      },
    });
  });

  afterEach(() => {
    autoLock.dispose();
    vi.useRealTimers();
  });

  it("locks at 5:00 and not before", () => {
    sessions.start(sessionFor("u1"));

    vi.advanceTimersByTime(5 * MIN - 1);
    expect(sessions.isLocked()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(sessions.isLocked()).toBe(true);
  });

  it("moves the lock out when activity is reported", () => {
    sessions.start(sessionFor("u1"));

    vi.advanceTimersByTime(4 * MIN);
    autoLock.reportActivity();
    vi.advanceTimersByTime(5 * MIN - 1);
    expect(sessions.isLocked()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(sessions.isLocked()).toBe(true);
  });

  it("never locks when the setting is Off", () => {
    minutes = null;
    sessions.start(sessionFor("u1"));
    autoLock.reportActivity();

    vi.advanceTimersByTime(2 * 60 * MIN);

    expect(sessions.isLocked()).toBe(false);
  });

  it("arms nothing without a session and does not read the setting", () => {
    autoLock.reportActivity();
    vi.advanceTimersByTime(10 * MIN);

    expect(vi.getTimerCount()).toBe(0);
    expect(reads).toBe(0);
  });

  it("ignores activity while locked and re-arms when the same user starts again", () => {
    sessions.start(sessionFor("u1"));
    sessions.lock();

    autoLock.reportActivity();
    expect(vi.getTimerCount()).toBe(0);

    sessions.start(sessionFor("u1"));
    vi.advanceTimersByTime(5 * MIN);
    expect(sessions.isLocked()).toBe(true);
  });

  it("clears the timer when the session ends and ignores activity afterwards", () => {
    sessions.start(sessionFor("u1"));
    sessions.end();
    expect(vi.getTimerCount()).toBe(0);

    autoLock.reportActivity();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not read the database on activity", () => {
    sessions.start(sessionFor("u1"));
    const readsAfterStart = reads;

    autoLock.reportActivity();
    autoLock.reportActivity();

    expect(reads).toBe(readsAfterStart);
  });

  it("refresh to 1 minute locks one minute after the change", () => {
    sessions.start(sessionFor("u1"));
    vi.advanceTimersByTime(3 * MIN);

    minutes = 1;
    autoLock.refresh();
    vi.advanceTimersByTime(MIN - 1);
    expect(sessions.isLocked()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(sessions.isLocked()).toBe(true);
  });

  it("refresh to Off cancels the pending lock", () => {
    sessions.start(sessionFor("u1"));

    minutes = null;
    autoLock.refresh();
    vi.advanceTimersByTime(2 * 60 * MIN);

    expect(sessions.isLocked()).toBe(false);
  });

  it("gives a newer session for another user a full period", () => {
    sessions.start(sessionFor("u1"));
    vi.advanceTimersByTime(4 * MIN);

    sessions.start(sessionFor("u2"));
    vi.advanceTimersByTime(MIN);
    expect(sessions.isLocked()).toBe(false);

    vi.advanceTimersByTime(4 * MIN);
    expect(sessions.isLocked()).toBe(true);
  });

  it("stops reacting after dispose", () => {
    autoLock.dispose();
    sessions.start(sessionFor("u1"));

    expect(vi.getTimerCount()).toBe(0);
  });
});
