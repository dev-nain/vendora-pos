import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  authMessages,
  type AuthResult,
  type CreateFirstUserResult,
  type createFirstUserInputSchema,
  type LoginUser,
  type loginInputSchema,
  type pinSwitchInputSchema,
  type SafeUser,
  type SessionState,
} from "../../shared/auth";
import { attemptPin, type PinLockState } from "../auth/pin-lockout";
import { hashCredential, verifyCredential } from "../auth/credentials";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { terminals, users } from "../db/schema";
import type { createAuditService } from "./audit";

type LoginInput = z.output<typeof loginInputSchema>;
type CreateFirstUserInput = z.output<typeof createFirstUserInputSchema>;
type PinSwitchInput = z.output<typeof pinSwitchInputSchema>;

interface AuthDeps {
  database: VendoraDatabase;
  audit: ReturnType<typeof createAuditService>;
  sessions: SessionStore;
  now?: () => Date;
}

const isActiveUser = and(eq(users.isActive, true), isNull(users.deletedAt));

const toSafeUser = (row: typeof users.$inferSelect): SafeUser => ({
  id: row.id,
  username: row.username,
  displayName: row.displayName,
});

const toLoginUser = (row: Pick<typeof users.$inferSelect, "id" | "displayName">) => ({
  id: row.id,
  displayName: row.displayName,
});

const invalidCredentials: AuthResult = {
  ok: false,
  reason: "invalid-credentials",
  message: authMessages.invalidCredentials,
};

const invalidPin: AuthResult = {
  ok: false,
  reason: "invalid-pin",
  message: authMessages.invalidPin,
};

let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashCredential("vendora-dummy-credential"));

export function createAuthService({ database, audit, sessions, now = () => new Date() }: AuthDeps) {
  const { db } = database;

  function storeId(): string {
    const terminal = db
      .select({ storeId: terminals.storeId })
      .from(terminals)
      .orderBy(asc(terminals.id))
      .limit(1)
      .get();
    if (!terminal) throw new Error("No terminal is configured");
    return terminal.storeId;
  }

  let pinQueue: Promise<unknown> = Promise.resolve();
  function serialisePin<T>(task: () => Promise<T>): Promise<T> {
    const run = pinQueue.then(task, task);
    pinQueue = run.catch(() => undefined);
    return run;
  }

  function savePinState(tx: Pick<typeof db, "update">, userId: string, state: PinLockState): void {
    tx.update(users)
      .set({ failedPinAttempts: state.failedPinAttempts, pinRetryAfter: state.pinRetryAfter })
      .where(eq(users.id, userId))
      .run();
  }

  async function login(input: LoginInput): Promise<AuthResult> {
    const user = db
      .select()
      .from(users)
      .where(and(sql`lower(${users.username}) = lower(${input.username})`, isActiveUser))
      .get();

    if (!user) {
      await verifyCredential(await getDummyHash(), input.password);
      return invalidCredentials;
    }
    if (!(await verifyCredential(user.passwordHash, input.password))) return invalidCredentials;

    const loggedInAt = now();
    const store = storeId();
    db.transaction((tx) => {
      audit.record({ action: "login", actorUserId: user.id, details: { method: "password" } }, tx);
    });
    sessions.start({ userId: user.id, storeId: store, loggedInAt });
    return { ok: true, user: toSafeUser(user) };
  }

  function switchByPin(input: PinSwitchInput): Promise<AuthResult> {
    return serialisePin(async () => {
      const previous = requireSession(sessions);
      const user = db
        .select()
        .from(users)
        .where(and(eq(users.id, input.userId), isActiveUser))
        .get();
      if (!user) return invalidPin;

      const at = now();
      const attempt = await attemptPin(user, user.pinHash, input.pin, at);

      if (attempt.outcome === "locked") {
        return {
          ok: false,
          reason: "pin-locked",
          message: authMessages.invalidPin,
          retryAfterMs: attempt.retryAfterMs,
        };
      }

      db.transaction((tx) => {
        savePinState(tx, user.id, attempt.state);
        if (attempt.outcome === "ok") {
          audit.record(
            {
              action: "login",
              actorUserId: user.id,
              details: { method: "pin", previousUserId: previous.userId },
            },
            tx,
          );
        }
      });

      if (attempt.outcome === "wrong") {
        const retryAt = attempt.state.pinRetryAfter;
        if (!retryAt) return invalidPin;
        return {
          ok: false,
          reason: "pin-locked",
          message: authMessages.invalidPin,
          retryAfterMs: retryAt.getTime() - at.getTime(),
        };
      }
      sessions.start({ userId: user.id, storeId: storeId(), loggedInAt: at });
      return { ok: true, user: toSafeUser(user) };
    });
  }

  function needsSetup(): boolean {
    return db.select({ id: users.id }).from(users).limit(1).get() === undefined;
  }

  const accountExists: CreateFirstUserResult = {
    ok: false,
    reason: "account-exists",
    message: authMessages.accountExists,
  };

  async function createFirstUser(input: CreateFirstUserInput): Promise<CreateFirstUserResult> {
    if (!needsSetup()) return accountExists;

    const [passwordHash, pinHash] = await Promise.all([
      hashCredential(input.password),
      hashCredential(input.pin),
    ]);

    const loggedInAt = now();
    const row = db.transaction((tx) => {
      if (tx.select({ id: users.id }).from(users).limit(1).get()) return null;
      const created = tx
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
          actorUserId: created.id,
          entityType: "user",
          entityId: created.id,
          details: { username: created.username },
        },
        tx,
      );
      audit.record(
        { action: "login", actorUserId: created.id, details: { method: "password" } },
        tx,
      );
      return created;
    });
    if (!row) return accountExists;

    sessions.start({ userId: row.id, storeId: storeId(), loggedInAt });
    return { ok: true, user: toSafeUser(row) };
  }

  function logout(): void {
    const session = sessions.current();
    if (!session) return;
    db.transaction((tx) => {
      audit.record({ action: "logout", actorUserId: session.userId }, tx);
    });
    sessions.end();
  }

  function current(): SessionState | null {
    const session = sessions.current();
    if (!session) return null;
    const user = db
      .select()
      .from(users)
      .where(and(eq(users.id, session.userId), isActiveUser))
      .get();
    if (!user) {
      sessions.end();
      return null;
    }
    return { user: toSafeUser(user) };
  }

  function listLoginUsers(): LoginUser[] {
    return db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(isActiveUser)
      .orderBy(asc(users.displayName))
      .all()
      .map(toLoginUser);
  }

  return {
    login,
    switchByPin,
    logout,
    current,
    listLoginUsers,
    needsSetup,
    createFirstUser,
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
