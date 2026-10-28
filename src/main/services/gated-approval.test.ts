import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApprovalStore, type ApprovalStore } from "../auth/approvals";
import { hashCredential } from "../auth/credentials";
import { ApprovalError } from "../auth/errors";
import { createSessionStore, type SessionStore } from "../auth/session";
import { openDatabase, type VendoraDatabase } from "../db/client";
import { runMigrations } from "../db/migrate";
import { auditLog, users } from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { createAuditService } from "./audit";
import { createAuthService } from "./auth";

const PIN = "4821";
let pinHash: string;

beforeAll(async () => {
  pinHash = await hashCredential(PIN);
});

describe("gated action with an approval token", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let approvals: ApprovalStore;
  let auth: ReturnType<typeof createAuthService>;
  let audit: ReturnType<typeof createAuditService>;

  const addUser = (username: string, role: "owner" | "manager" | "cashier") =>
    database.db
      .insert(users)
      .values({ username, displayName: username, role, passwordHash: pinHash, pinHash })
      .returning()
      .get();

  const openDrawerNoSale = (token: string) =>
    database.db.transaction((tx) => {
      const { approverUserId, requestedByUserId } = approvals.consumeApproval(
        token,
        "drawer.open-no-sale",
      );
      audit.record(
        {
          action: "override",
          actorUserId: requestedByUserId,
          approverUserId,
          details: { gatedAction: "drawer.open-no-sale" },
        },
        tx,
      );
    });

  const overrideRows = () =>
    database.db
      .select()
      .from(auditLog)
      .all()
      .filter((row) => row.action === "override");

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-gated-"));
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, {
      migrationsFolder: join(process.cwd(), "drizzle"),
      backupDir: join(dir, "backups"),
    });
    seedStoreAndTerminal(database);
    sessions = createSessionStore();
    approvals = createApprovalStore({ sessions });
    audit = createAuditService(database);
    auth = createAuthService({ database, audit, sessions, approvals });
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function approvedToken(action: "drawer.open-no-sale" | "stock.adjust") {
    const manager = addUser("manager", "manager");
    const cashier = addUser("cashier", "cashier");
    sessions.start({
      userId: cashier.id,
      role: "cashier",
      storeId: "store",
      loggedInAt: new Date(),
    });
    const result = await auth.approve({ action, approverUserId: manager.id, pin: PIN });
    if (!result.ok) throw new Error("expected approval");
    return { token: result.token, manager, cashier };
  }

  it("writes one override row carrying the approver", async () => {
    const { token, manager, cashier } = await approvedToken("drawer.open-no-sale");

    openDrawerNoSale(token);

    const rows = overrideRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.approverUserId).toBe(manager.id);
    expect(rows[0]!.actorUserId).toBe(cashier.id);
    expect(rows[0]!.details).not.toContain(token);
  });

  it("refuses a reused token and writes no second row", async () => {
    const { token } = await approvedToken("drawer.open-no-sale");
    openDrawerNoSale(token);

    expect(() => openDrawerNoSale(token)).toThrow(ApprovalError);
    expect(overrideRows()).toHaveLength(1);
  });

  it("refuses a token issued for another action", async () => {
    const { token } = await approvedToken("stock.adjust");

    expect(() => openDrawerNoSale(token)).toThrow(ApprovalError);
    expect(overrideRows()).toHaveLength(0);
  });
});
