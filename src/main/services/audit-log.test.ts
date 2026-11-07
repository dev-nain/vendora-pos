import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUDIT_PAGE_SIZE, type AuditAction, type AuditListQuery } from "../../shared/audit";
import { UnauthenticatedError } from "../auth/errors";
import { createSessionStore, type SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import {
  auditLog,
  categories,
  products,
  stores,
  taxCategories,
  terminals,
  users,
} from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { openMigratedDatabase } from "../db/test-database";
import { createAuditLogService } from "./audit-log";

const newUser = (username: string, extra: { isActive?: boolean; deletedAt?: Date } = {}) => ({
  username,
  displayName: username,
  passwordHash: "secret-hash",
  pinHash: "secret-pin",
  ...extra,
});

const day = (y: number, m: number, d: number, ms = 0) => new Date(y, m - 1, d, 0, 0, 0, ms);
const isoDay = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

describe("createAuditLogService", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let service: ReturnType<typeof createAuditLogService>;
  let storeId: string;
  let terminalId: string;
  let alice: string;
  let bob: string;

  const add = (
    actorUserId: string,
    action: AuditAction,
    createdAt: Date,
    extra: { entityType?: string; entityId?: string; details?: string; storeId?: string } = {},
  ) =>
    database.db
      .insert(auditLog)
      .values({
        storeId,
        terminalId,
        actorUserId,
        action,
        createdAt,
        entityType: extra.entityType ?? null,
        entityId: extra.entityId ?? null,
        details: extra.details ?? null,
        ...(extra.storeId ? { storeId: extra.storeId } : {}),
      })
      .returning({ id: auditLog.id })
      .get().id;

  const times = (query: AuditListQuery) =>
    service.list(query).entries.map((entry) => `${entry.actorName}:${entry.action}`);

  const ids = (query: AuditListQuery) => service.list(query).entries.map((entry) => entry.id);

  const seed = (count: number, actor = alice) => {
    const base = day(2026, 4, 1).getTime();
    return Array.from({ length: count }, (_, i) =>
      add(actor, "login", new Date(base + i * 1000)),
    ).toReversed();
  };

  const walk = (query: AuditListQuery = {}) => {
    const pages: string[][] = [];
    let before = query.before;
    for (;;) {
      const page = service.list({ ...query, ...(before ? { before } : {}) });
      pages.push(page.entries.map((entry) => entry.id));
      if (!page.nextCursor) return pages;
      before = page.nextCursor;
    }
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-audit-log-"));
    database = openMigratedDatabase(join(dir, "vendora.db"));
    seedStoreAndTerminal(database);
    storeId = database.db.select().from(stores).get()!.id;
    terminalId = database.db.select().from(terminals).get()!.id;
    alice = database.db.insert(users).values(newUser("alice")).returning().get().id;
    bob = database.db.insert(users).values(newUser("bob")).returning().get().id;
    sessions = createSessionStore();
    sessions.start({ userId: alice, storeId, loggedInAt: new Date() });
    service = createAuditLogService({ database, sessions });
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns newest first, with equal times in id descending order", () => {
    const t = day(2026, 3, 1);
    const a = add(alice, "login", new Date(t.getTime() + 1000));
    const b = add(alice, "logout", t);
    const c = add(alice, "logout", t);
    const tied = [b, c].toSorted().toReversed();
    expect(service.list({}).entries.map((entry) => entry.id)).toEqual([a, ...tied]);
  });

  describe("filters", () => {
    beforeEach(() => {
      add(alice, "login", day(2026, 3, 1, 5));
      add(alice, "logout", day(2026, 3, 2, 5));
      add(bob, "login", day(2026, 3, 3, 5));
      add(bob, "logout", day(2026, 3, 4, 5));
      add(alice, "login", day(2026, 3, 5, 5));
    });

    it("filters by user", () => {
      expect(times({ userId: bob })).toEqual(["bob:logout", "bob:login"]);
    });

    it("filters by action", () => {
      expect(times({ action: "logout" })).toEqual(["bob:logout", "alice:logout"]);
    });

    it("filters by from and to", () => {
      expect(times({ from: isoDay(2026, 3, 4) })).toHaveLength(2);
      expect(times({ to: isoDay(2026, 3, 2) })).toHaveLength(2);
      expect(times({ from: isoDay(2026, 3, 2), to: isoDay(2026, 3, 4) })).toHaveLength(3);
    });

    it("returns exactly the intersection of combined filters", () => {
      expect(times({ userId: alice, action: "login" })).toEqual(["alice:login", "alice:login"]);
      expect(times({ userId: alice, from: isoDay(2026, 3, 2) })).toEqual([
        "alice:login",
        "alice:logout",
      ]);
      expect(times({ action: "login", to: isoDay(2026, 3, 3) })).toEqual([
        "bob:login",
        "alice:login",
      ]);
      expect(
        times({ userId: bob, action: "login", from: isoDay(2026, 3, 3), to: isoDay(2026, 3, 3) }),
      ).toEqual(["bob:login"]);
      expect(times({ userId: bob, action: "login", from: isoDay(2026, 3, 4) })).toEqual([]);
    });
  });

  it("treats from and to as inclusive local days", () => {
    const before = add(alice, "login", day(2026, 5, 9, -1));
    const first = add(alice, "login", day(2026, 5, 10));
    const last = add(alice, "login", day(2026, 5, 11, -1));
    const after = add(alice, "login", day(2026, 5, 11));
    expect(ids({ from: isoDay(2026, 5, 10) }).toSorted()).toEqual([first, last, after].toSorted());
    expect(ids({ from: isoDay(2026, 5, 10) })).not.toContain(before);
    expect(ids({ to: isoDay(2026, 5, 10) }).toSorted()).toEqual([before, first, last].toSorted());
    expect(ids({ to: isoDay(2026, 5, 10) })).not.toContain(after);
  });

  describe("paging", () => {
    it("walks 125 rows as pages of 50, 50 and 25", () => {
      const expected = seed(125);
      const pages = walk();
      expect(pages.map((page) => page.length)).toEqual([50, 50, 25]);
      expect(pages.flat()).toEqual(expected);
    });

    it("ends with a null cursor when the total is an exact multiple of the page size", () => {
      seed(AUDIT_PAGE_SIZE * 2);
      const first = service.list({});
      expect(first.nextCursor).not.toBeNull();
      const second = service.list({ before: first.nextCursor! });
      expect(second.entries).toHaveLength(AUDIT_PAGE_SIZE);
      expect(second.nextCursor).toBeNull();
    });

    it("loses and repeats nothing across 120 rows in one millisecond", () => {
      const t = day(2026, 4, 2);
      const created = Array.from({ length: 120 }, () => add(alice, "login", t));
      const pages = walk();
      expect(pages.flat()).toEqual(created.toSorted().toReversed());
    });

    it("keeps the filter on every page", () => {
      seed(70, alice);
      seed(70, bob);
      const pages = walk({ userId: bob });
      expect(pages.flat()).toHaveLength(70);
      const bobIds = new Set(
        database.db
          .select()
          .from(auditLog)
          .all()
          .filter((row) => row.actorUserId === bob)
          .map((row) => row.id),
      );
      expect(pages.flat().every((id) => bobIds.has(id))).toBe(true);
    });

    it("does not shift page two when a row arrives after page one", () => {
      seed(80);
      const first = service.list({});
      add(alice, "logout", new Date(Date.now() + 60_000));
      const second = service.list({ before: first.nextCursor! });
      expect(second.entries).toHaveLength(30);
      expect(new Set([...first.entries, ...second.entries].map((entry) => entry.id)).size).toBe(80);
    });
  });

  it("resolves the actor name for inactive and soft-deleted users", () => {
    const inactive = database.db
      .insert(users)
      .values(newUser("idle", { isActive: false }))
      .returning()
      .get().id;
    const deleted = database.db
      .insert(users)
      .values(newUser("gone", { deletedAt: new Date() }))
      .returning()
      .get().id;
    add(inactive, "login", day(2026, 1, 1));
    add(deleted, "login", day(2026, 1, 2));
    expect(service.list({}).entries.map((entry) => entry.actorName)).toEqual(["gone", "idle"]);
  });

  it("resolves product names only for product entities", () => {
    const categoryId = database.db.select().from(categories).get()!.id;
    const taxCategoryId = database.db.select().from(taxCategories).get()!.id;
    const product = database.db
      .insert(products)
      .values({
        storeId,
        nameEn: "Tapal 950g",
        searchText: "tapal 950g",
        categoryId,
        taxCategoryId,
        unit: "piece",
        costPaisa: 100,
        salePricePaisa: 150,
        deletedAt: new Date(),
      })
      .returning()
      .get();
    add(alice, "price_change", day(2026, 1, 1), { entityType: "product", entityId: product.id });
    add(alice, "settings_change", day(2026, 1, 2), {
      entityType: "category",
      entityId: product.id,
    });
    const entries = service.list({}).entries;
    expect(entries.map((entry) => entry.productName)).toEqual([null, "Tapal 950g"]);
  });

  it("returns details parsed and null as null", () => {
    add(alice, "login", day(2026, 1, 1), { details: JSON.stringify({ method: "password", n: 2 }) });
    add(alice, "logout", day(2026, 1, 2));
    expect(service.list({}).entries.map((entry) => entry.details)).toEqual([
      null,
      { method: "password", n: 2 },
    ]);
  });

  it("does not return another store's rows", () => {
    const other = database.db.insert(stores).values({}).returning().get().id;
    add(alice, "login", day(2026, 1, 1), { storeId: other });
    const mine = add(alice, "login", day(2026, 1, 2));
    expect(service.list({}).entries.map((entry) => entry.id)).toEqual([mine]);
  });

  it("refuses with no session", () => {
    sessions.end();
    expect(() => service.list({})).toThrow(UnauthenticatedError);
    expect(() => service.users()).toThrow(UnauthenticatedError);
  });

  it("lists every user, inactive and deleted included, with only id and name", () => {
    database.db
      .insert(users)
      .values(newUser("idle", { isActive: false }))
      .run();
    database.db
      .insert(users)
      .values(newUser("gone", { deletedAt: new Date() }))
      .run();
    const list = service.users();
    expect(list.map((user) => user.displayName)).toEqual(["alice", "bob", "gone", "idle"]);
    expect(list.every((user) => Object.keys(user).toSorted().join() === "displayName,id")).toBe(
      true,
    );
  });

  it("exposes only list and users", () => {
    expect(Object.keys(createAuditLogService({ database, sessions })).toSorted()).toEqual([
      "list",
      "users",
    ]);
  });

  it("reads without writing to the log", () => {
    add(alice, "login", day(2026, 1, 1));
    service.list({});
    service.users();
    expect(database.db.select().from(auditLog).all()).toHaveLength(1);
  });
});
