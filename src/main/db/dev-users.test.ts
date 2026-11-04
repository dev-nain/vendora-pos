import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { passwordSchema, pinSchema } from "../../shared/credentials";
import { createSessionStore } from "../auth/session";
import { createAuditService } from "../services/audit";
import { createAuthService } from "../services/auth";
import { openDatabase, type VendoraDatabase } from "./client";
import { devUsers, seedDevUsers } from "./dev-users";
import { runMigrations } from "./migrate";
import { users } from "./schema";
import { seedStoreAndTerminal } from "./seed";

describe("seedDevUsers", () => {
  let dir: string;
  let database: VendoraDatabase;
  let auth: ReturnType<typeof createAuthService>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "vendora-dev-users-"));
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, {
      migrationsFolder: join(process.cwd(), "drizzle"),
      backupDir: join(dir, "backups"),
    });
    seedStoreAndTerminal(database);
    await seedDevUsers(database);
    const sessions = createSessionStore();
    auth = createAuthService({
      database,
      audit: createAuditService(database),
      sessions,
    });
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates three active users and is idempotent", async () => {
    await seedDevUsers(database);
    const rows = database.db.select().from(users).all();
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.isActive && row.deletedAt === null)).toBe(true);
    expect(rows.map((row) => row.username).toSorted()).toEqual(["cashier", "manager", "owner"]);
  });

  it("uses credentials that satisfy the shared schemas", () => {
    for (const fixture of devUsers) {
      expect(passwordSchema.safeParse(fixture.password).success).toBe(true);
      expect(pinSchema.safeParse(fixture.pin).success).toBe(true);
    }
  });

  it("lets the first fixture log in and switch by PIN to the others", async () => {
    const [owner, manager, cashier] = devUsers;
    const login = await auth.login({ username: owner.username, password: owner.password });
    expect(login.ok).toBe(true);
    expect(auth.current()?.user.username).toBe("owner");

    for (const target of [manager, cashier]) {
      const id = auth.listLoginUsers().find((user) => user.displayName === target.displayName)!.id;
      const result = await auth.switchByPin({ userId: id, pin: target.pin });
      expect(result.ok).toBe(true);
      expect(auth.current()?.user.displayName).toBe(target.displayName);
    }
  });

  it("refuses a wrong password with the generic message", async () => {
    for (const fixture of devUsers) {
      expect(await auth.login({ username: fixture.username, password: "wrong" })).toMatchObject({
        ok: false,
        reason: "invalid-credentials",
        message: "Username or password is incorrect",
      });
    }
  });
});
