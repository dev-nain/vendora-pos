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
import type { ApprovalStore } from "../auth/approvals";
import { hashCredential } from "../auth/credentials";
import { requireSessionPermission } from "../auth/guard";
import { pinLockStatus, recordPinSuccess } from "../auth/pin-lockout";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { users } from "../db/schema";
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
  approvals: ApprovalStore;
  now?: () => Date;
}

type UserRow = typeof users.$inferSelect;

const activeOwner = and(eq(users.role, "owner"), eq(users.isActive, true), isNull(users.deletedAt));

const usernameTaken = {
  ok: false,
  reason: "username-taken",
  message: userMessages.usernameTaken,
} as const;

const lastOwner = {
  ok: false,
  reason: "last-owner",
  message: userMessages.lastOwner,
} as const;

const notFound = {
  ok: false,
  reason: "not-found",
  message: userMessages.notFound,
} as const;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: unknown }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

export function createUsersService({
  database,
  audit,
  sessions,
  approvals,
  now = () => new Date(),
}: UsersDeps) {
  const { db } = database;

  const toManagedUser = (row: UserRow): ManagedUser => ({
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    isActive: row.isActive,
    pinLocked: pinLockStatus(row, now()).locked,
  });

  function endSession(): void {
    approvals.clear();
    sessions.end();
  }

  function list(): ManagedUser[] {
    requireSessionPermission(sessions, "users.manage");
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
    const owner = requireSessionPermission(sessions, "users.manage");
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
            role: input.role,
            passwordHash,
            pinHash,
          })
          .returning()
          .get();
        audit.record(
          {
            action: "user_create",
            actorUserId: owner.userId,
            entityType: "user",
            entityId: row.id,
            details: { username: row.username, role: row.role },
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
    const owner = requireSessionPermission(sessions, "users.manage");
    const result = db.transaction((tx): UpdateUserResult => {
      const target = tx.select().from(users).where(eq(users.id, input.id)).get();
      if (!target) return notFound;

      const roleChanged = input.role !== target.role;
      const nameChanged = input.displayName !== target.displayName;

      if (target.role === "owner" && target.isActive && roleChanged) {
        const owners = tx.select({ id: users.id }).from(users).where(activeOwner).all();
        if (owners.length <= 1) return lastOwner;
      }
      if (!roleChanged && !nameChanged) return { ok: true, sessionEnded: false };

      const changes: Record<string, { from: string; to: string }> = {};
      if (nameChanged) changes.displayName = { from: target.displayName, to: input.displayName };
      if (roleChanged) changes.role = { from: target.role, to: input.role };

      tx.update(users)
        .set({ displayName: input.displayName, role: input.role, updatedAt: now() })
        .where(eq(users.id, target.id))
        .run();
      audit.record(
        {
          action: "user_update",
          actorUserId: owner.userId,
          entityType: "user",
          entityId: target.id,
          details: { changes },
        },
        tx,
      );
      return { ok: true, sessionEnded: roleChanged && target.id === owner.userId };
    });

    if (result.ok && result.sessionEnded) endSession();
    return result;
  }

  async function resetPassword(input: ResetPasswordInput): Promise<UserActionResult> {
    const owner = requireSessionPermission(sessions, "users.manage");
    const passwordHash = await hashCredential(input.password);
    return db.transaction((tx): UserActionResult => {
      const target = tx.select({ id: users.id }).from(users).where(eq(users.id, input.id)).get();
      if (!target) return notFound;
      tx.update(users).set({ passwordHash, updatedAt: now() }).where(eq(users.id, target.id)).run();
      audit.record(
        {
          action: "user_update",
          actorUserId: owner.userId,
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
    const owner = requireSessionPermission(sessions, "users.manage");
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
          actorUserId: owner.userId,
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
    const owner = requireSessionPermission(sessions, "users.manage");
    const result = db.transaction((tx): DeactivateUserResult => {
      const target = tx.select().from(users).where(eq(users.id, input.id)).get();
      if (!target) return notFound;
      if (!target.isActive) return { ok: true, sessionEnded: false };

      if (target.role === "owner") {
        const owners = tx.select({ id: users.id }).from(users).where(activeOwner).all();
        if (owners.length <= 1) return lastOwner;
      }

      tx.update(users)
        .set({ isActive: false, updatedAt: now() })
        .where(eq(users.id, target.id))
        .run();
      audit.record(
        {
          action: "user_deactivate",
          actorUserId: owner.userId,
          entityType: "user",
          entityId: target.id,
          details: { username: target.username },
        },
        tx,
      );
      return { ok: true, sessionEnded: target.id === owner.userId };
    });

    if (result.ok && result.sessionEnded) endSession();
    return result;
  }

  function reactivate(input: UserIdInput): UserActionResult {
    const owner = requireSessionPermission(sessions, "users.manage");
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
          actorUserId: owner.userId,
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
