import { describe, expect, it } from "vitest";
import { userRoleSchema } from "../../shared/auth";
import { userRoles, type UserRole } from "../db/schema";
import { ForbiddenError, UnauthenticatedError } from "./errors";
import { requireSession, requireSessionPermission } from "./guard";
import { createSessionStore, type Session } from "./session";

const sessionFor = (role: UserRole): Session => ({
  userId: "u1",
  role,
  storeId: "s1",
  loggedInAt: new Date(0),
});

describe("userRoleSchema", () => {
  it("matches the database roles", () => {
    expect(userRoleSchema.options).toEqual([...userRoles]);
  });
});

describe("session store", () => {
  it("holds, replaces and clears the session", () => {
    const sessions = createSessionStore();
    expect(sessions.current()).toBeNull();

    sessions.start(sessionFor("cashier"));
    expect(sessions.current()?.role).toBe("cashier");

    sessions.start(sessionFor("owner"));
    expect(sessions.current()?.role).toBe("owner");

    sessions.end();
    expect(sessions.current()).toBeNull();
  });
});

describe("requireSession", () => {
  it("throws with no session", () => {
    expect(() => requireSession(createSessionStore())).toThrow(UnauthenticatedError);
  });

  it("returns the current session", () => {
    const sessions = createSessionStore();
    const session = sessionFor("manager");
    sessions.start(session);

    expect(requireSession(sessions)).toBe(session);
  });
});

describe("requireSessionPermission", () => {
  it("throws UnauthenticatedError with no session", () => {
    expect(() => requireSessionPermission(createSessionStore(), "sale.sell")).toThrow(
      UnauthenticatedError,
    );
  });

  it("throws ForbiddenError for a cashier on users.manage", () => {
    const sessions = createSessionStore();
    sessions.start(sessionFor("cashier"));

    expect(() => requireSessionPermission(sessions, "users.manage")).toThrow(ForbiddenError);
  });

  it("returns the session for an owner", () => {
    const sessions = createSessionStore();
    const session = sessionFor("owner");
    sessions.start(session);

    expect(requireSessionPermission(sessions, "users.manage")).toBe(session);
  });
});
