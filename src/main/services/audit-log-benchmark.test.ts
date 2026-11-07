import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditPageSchema,
  type AuditCursor,
  type AuditListQuery,
  type AuditPage,
} from "../../shared/audit";
import { createSessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { categories, products, stores, taxCategories, terminals, users } from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { openMigratedDatabase } from "../db/test-database";
import { createAuditLogService } from "./audit-log";

const entryCount = 100_000;
const budgetMs = 100;

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;

const report = (label: string, durations: number[]) => {
  const sorted = durations.toSorted((a, b) => a - b);
  const p95 = percentile(sorted, 0.95);
  console.log(
    `${label}: p50 ${percentile(sorted, 0.5).toFixed(3)} ms / p95 ${p95.toFixed(3)} ms / max ${sorted.at(-1)!.toFixed(3)} ms`,
  );
  return p95;
};

const isoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

describe("audit log benchmark", () => {
  let dir: string;
  let database: VendoraDatabase;
  let service: ReturnType<typeof createAuditLogService>;
  let userIds: string[];
  let firstDay: string;
  const cursors: (AuditCursor | undefined)[] = [];

  const page = (query: AuditListQuery): AuditPage => auditPageSchema.parse(service.list(query));

  const time = (query: AuditListQuery) => {
    const start = performance.now();
    page(query);
    return performance.now() - start;
  };

  const timeWalk = (filter: AuditListQuery, maxPages: number) => {
    const durations: number[] = [];
    let before: AuditCursor | undefined;
    for (let n = 0; n < maxPages; n++) {
      const query = { ...filter, ...(before ? { before } : {}) };
      const start = performance.now();
      const result = page(query);
      durations.push(performance.now() - start);
      if (!result.nextCursor) break;
      before = result.nextCursor;
    }
    return durations;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-audit-bench-"));
    database = openMigratedDatabase(join(dir, "test.db"));
    seedStoreAndTerminal(database);
    const storeId = database.db.select().from(stores).get()!.id;
    const terminalId = database.db.select().from(terminals).get()!.id;
    const categoryId = database.db.select().from(categories).get()!.id;
    const taxCategoryId = database.db.select().from(taxCategories).get()!.id;
    userIds = ["Ayesha", "Bilal", "Chand"].map(
      (name) =>
        database.db
          .insert(users)
          .values({ username: name, displayName: name, passwordHash: "x", pinHash: "x" })
          .returning()
          .get().id,
    );
    for (let p = 0; p < 10; p++) {
      database.db
        .insert(products)
        .values({
          storeId,
          nameEn: `Item ${p}`,
          searchText: `item ${p}`,
          categoryId,
          taxCategoryId,
          unit: "piece",
          costPaisa: 1000,
          salePricePaisa: 1500,
        })
        .run();
    }

    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const base = midnight.getTime() - 40 * 60 * 1000;
    firstDay = isoDay(new Date(base));

    database.sqlite
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < @count - 1),
         p(k, id) AS (SELECT row_number() OVER (ORDER BY id) - 1, id FROM products)
         INSERT INTO audit_log (id, store_id, terminal_id, actor_user_id, action, entity_type, entity_id, details, created_at)
         SELECT printf('00000000-0000-7000-8000-%012d', i), @storeId, @terminalId,
                CASE WHEN i % 5000 = 7 THEN @user0
                     WHEN i % 3 = 0 THEN @user0 WHEN i % 3 = 1 THEN @user1 ELSE @user2 END,
                CASE WHEN i % 5000 = 7 THEN 'restore'
                     WHEN i % 500 = 11 THEN 'price_change'
                     ELSE CASE i % 6 WHEN 0 THEN 'login' WHEN 1 THEN 'logout' WHEN 2 THEN 'sale_complete'
                                     WHEN 3 THEN 'line_delete' WHEN 4 THEN 'settings_change' ELSE 'login' END END,
                CASE WHEN i % 500 = 11 THEN 'product' END,
                CASE WHEN i % 500 = 11 THEN (SELECT p.id FROM p WHERE p.k = (i / 500) % 10) END,
                '{"invoiceNo":"T1-' || i || '","lineCount":3,"totalPaisa":124000,"method":"password"}',
                @base + ((i - (i % 4 = 3)) * 50)
         FROM n`,
      )
      .run({
        count: entryCount,
        storeId,
        terminalId,
        user0: userIds[0],
        user1: userIds[1],
        user2: userIds[2],
        base,
      });

    const sessions = createSessionStore();
    sessions.start({ userId: userIds[0]!, storeId, loggedInAt: new Date() });
    service = createAuditLogService({ database, sessions });
  }, 180_000);

  afterAll(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("walks every page of the unfiltered log", () => {
    const seen = new Set<string>();
    const durations: number[] = [];
    let before: AuditCursor | undefined;
    for (;;) {
      cursors.push(before);
      const start = performance.now();
      const result = page(before ? { before } : {});
      durations.push(performance.now() - start);
      for (const entry of result.entries) seen.add(entry.id);
      if (!result.nextCursor) break;
      before = result.nextCursor;
    }
    expect(seen.size).toBe(entryCount);
    expect(report("full walk", durations)).toBeLessThan(budgetMs);
  });

  it("reads the deepest page quickly", () => {
    const deepest = cursors.at(-1);
    const durations = Array.from({ length: 200 }, () => time(deepest ? { before: deepest } : {}));
    expect(report("deepest page", durations)).toBeLessThan(budgetMs);
  });

  it("filters by user", () => {
    expect(report("user filter", timeWalk({ userId: userIds[1] }, 300))).toBeLessThan(budgetMs);
  });

  it("filters by action", () => {
    expect(report("action filter", timeWalk({ action: "line_delete" }, 300))).toBeLessThan(
      budgetMs,
    );
  });

  it("filters by a one-day range deep in the data", () => {
    const deep = cursors[Math.floor(cursors.length * 0.9)];
    const durations = Array.from({ length: 100 }, () =>
      time({ from: firstDay, to: firstDay, ...(deep ? { before: deep } : {}) }),
    );
    expect(report("day range", durations)).toBeLessThan(budgetMs);
  });

  it("filters by user, action and date together", () => {
    const durations = timeWalk(
      { userId: userIds[0], action: "login", from: firstDay, to: firstDay },
      300,
    );
    expect(report("user + action + date", durations)).toBeLessThan(budgetMs);
  });

  it("filters by one user and a rare action", () => {
    const durations = Array.from({ length: 100 }, () =>
      time({ userId: userIds[0], action: "restore" }),
    );
    expect(page({ userId: userIds[0], action: "restore" }).entries).toHaveLength(20);
    expect(report("user + rare action", durations)).toBeLessThan(budgetMs);
  });
}, 180_000);
