import { describe, expect, it } from "vitest";
import { userRoleSchema } from "../../shared/auth";
import { userRoles, type UserRole } from "../db/schema";
import { UnauthenticatedError } from "./errors";
import { requireSession } from "./guard";
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
