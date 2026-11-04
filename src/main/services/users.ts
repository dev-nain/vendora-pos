import { and, eq, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  userMessages,
  type CreateUserResult,
  type createUserInputSchema,
  type DeactivateUserResult,
  type ManagedUser,
  type resetPasswordInputSchema,
  type resetPinInputSchema,
  type UpdateUserResult,
  type updateUserInputSchema,
  type UserActionResult,
  type userIdInputSchema,
} from "../../shared/users";
import { hashCredential } from "../auth/credentials";
import { requireSession } from "../auth/guard";
import { pinLockStatus, recordPinSuccess } from "../auth/pin-lockout";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { users } from "../db/schema";
import { isUniqueViolation } from "../db/sqlite-errors";
import type { createAuditService } from "./audit";

type CreateInput = z.output<typeof createUserInputSchema>;
type UpdateInput = z.output<typeof updateUserInputSchema>;
type ResetPasswordInput = z.output<typeof resetPasswordInputSchema>;
type ResetPinInput = z.output<typeof resetPinInputSchema>;
type UserIdInput = z.output<typeof userIdInputSchema>;

interface UsersDeps {
  database: VendoraDatabase;
  audit: ReturnType<typeof createAuditService>;
  sessions: SessionStore;
  now?: () => Date;
}

type UserRow = typeof users.$inferSelect;

const isActiveUser = and(eq(users.isActive, true), isNull(users.deletedAt));

const usernameTaken = {
  ok: false,
  reason: "username-taken",
  message: userMessages.usernameTaken,
} as const;

const lastActiveUser = {
  ok: false,
  reason: "last-active-user",
  message: userMessages.lastActiveUser,
} as const;

const notFound = {
  ok: false,
  reason: "not-found",
  message: userMessages.notFound,
} as const;

export function createUsersService({
  database,
  audit,
  sessions,
  now = () => new Date(),
}: UsersDeps) {
  const { db } = database;

  const toManagedUser = (row: UserRow): ManagedUser => ({
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    isActive: row.isActive,
    pinLocked: pinLockStatus(row, now()).locked,
  });

  function list(): ManagedUser[] {
    requireSession(sessions);
    return db
      .select()
      .from(users)
      .all()
      .toSorted(
        (a, b) =>
          Number(b.isActive) - Number(a.isActive) ||
          a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()),
      )
      .map(toManagedUser);
  }

  async function create(input: CreateInput): Promise<CreateUserResult> {
    const actor = requireSession(sessions);
    const [passwordHash, pinHash] = await Promise.all([
      hashCredential(input.password),
      hashCredential(input.pin),
    ]);

    try {
      return db.transaction((tx): CreateUserResult => {
        const existing = tx
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.username}) = lower(${input.username})`)
          .get();
        if (existing) return usernameTaken;

        const row = tx
          .insert(users)
          .values({
            username: input.username,
            displayName: input.displayName,
            passwordHash,
            pinHash,
          })
          .returning()
          .get();
        audit.record(
          {
            action: "user_create",
            actorUserId: actor.userId,
            entityType: "user",
            entityId: row.id,
            details: { username: row.username },
          },
          tx,
        );
        return { ok: true, user: toManagedUser(row) };
      });
    } catch (error) {
      if (isUniqueViolation(error)) return usernameTaken;
      throw error;
    }
  }

  function update(input: UpdateInput): UpdateUserResult {
    const actor = requireSession(sessions);
    return db.transaction((tx): UpdateUserResult => {
      const target = tx.select().from(users).where(eq(users.id, input.id)).get();
      if (!target) return notFound;
      if (input.displayName === target.displayName) return { ok: true };

      tx.update(users)
        .set({ displayName: input.displayName, updatedAt: now() })
        .where(eq(users.id, target.id))
        .run();
      audit.record(
        {
          action: "user_update",
          actorUserId: actor.userId,
          entityType: "user",
          entityId: target.id,
          details: {
            changes: { displayName: { from: target.displayName, to: input.displayName } },
          },
        },
        tx,
      );
      return { ok: true };
    });
  }

  async function resetPassword(input: ResetPasswordInput): Promise<UserActionResult> {
    const actor = requireSession(sessions);
    const passwordHash = await hashCredential(input.password);
    return db.transaction((tx): UserActionResult => {
      const target = tx.select({ id: users.id }).from(users).where(eq(users.id, input.id)).get();
      if (!target) return notFound;
      tx.update(users).set({ passwordHash, updatedAt: now() }).where(eq(users.id, target.id)).run();
      audit.record(
        {
          action: "user_update",
          actorUserId: actor.userId,
          entityType: "user",
          entityId: target.id,
          details: { reset: "password" },
        },
        tx,
      );
      return { ok: true };
    });
  }

  async function resetPin(input: ResetPinInput): Promise<UserActionResult> {
    const actor = requireSession(sessions);
    const pinHash = await hashCredential(input.pin);
    return db.transaction((tx): UserActionResult => {
      const target = tx.select({ id: users.id }).from(users).where(eq(users.id, input.id)).get();
      if (!target) return notFound;
      tx.update(users)
        .set({ pinHash, ...recordPinSuccess(), updatedAt: now() })
        .where(eq(users.id, target.id))
        .run();
      audit.record(
        {
          action: "user_update",
          actorUserId: actor.userId,
          entityType: "user",
          entityId: target.id,
          details: { reset: "pin" },
        },
        tx,
      );
      return { ok: true };
    });
  }

  function deactivate(input: UserIdInput): DeactivateUserResult {
    const actor = requireSession(sessions);
    const result = db.transaction((tx): DeactivateUserResult => {
      const target = tx.select().from(users).where(eq(users.id, input.id)).get();
      if (!target) return notFound;
      if (!target.isActive) return { ok: true, sessionEnded: false };

      const activeUsers = tx.select({ id: users.id }).from(users).where(isActiveUser).all();
      if (activeUsers.length <= 1) return lastActiveUser;

      tx.update(users)
        .set({ isActive: false, updatedAt: now() })
        .where(eq(users.id, target.id))
        .run();
      audit.record(
        {
          action: "user_deactivate",
          actorUserId: actor.userId,
          entityType: "user",
          entityId: target.id,
          details: { username: target.username },
        },
        tx,
      );
      return { ok: true, sessionEnded: target.id === actor.userId };
    });

    if (result.ok && result.sessionEnded) sessions.end();
    return result;
  }

  function reactivate(input: UserIdInput): UserActionResult {
    const actor = requireSession(sessions);
    return db.transaction((tx): UserActionResult => {
      const target = tx.select().from(users).where(eq(users.id, input.id)).get();
      if (!target) return notFound;
      if (target.isActive) return { ok: true };

      tx.update(users)
        .set({ isActive: true, updatedAt: now() })
        .where(eq(users.id, target.id))
        .run();
      audit.record(
        {
          action: "user_reactivate",
          actorUserId: actor.userId,
          entityType: "user",
          entityId: target.id,
          details: { username: target.username },
        },
        tx,
      );
      return { ok: true };
    });
  }

  return { list, create, update, resetPassword, resetPin, deactivate, reactivate };
}

export type UsersService = ReturnType<typeof createUsersService>;
