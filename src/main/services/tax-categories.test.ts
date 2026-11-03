import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { categories } from "../db/schema";
import {
  createTaxCategoryInputSchema,
  taxCategoryMessages,
  updateTaxCategoryInputSchema,
} from "../../shared/tax-categories";
import { ForbiddenError, SessionLockedError, UnauthenticatedError } from "../auth/errors";
import { createSessionStore, type SessionStore } from "../auth/session";
import { openDatabase, type VendoraDatabase } from "../db/client";
import { runMigrations } from "../db/migrate";
import { auditLog, products, stores, taxCategories, users, type UserRole } from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { createAuditService } from "./audit";
import { createTaxCategoriesService } from "./tax-categories";

const uuid = "01900000-0000-7000-8000-000000000001";

describe("tax category schemas", () => {
  it("accepts rates from 0 to 10000", () => {
    expect(createTaxCategoryInputSchema.safeParse({ name: "A", rateBps: 0 }).success).toBe(true);
    expect(createTaxCategoryInputSchema.safeParse({ name: "A", rateBps: 10000 }).success).toBe(
      true,
    );
  });

  it.each([null, -1, 10001, 1.5, undefined, "5"])("rejects create rateBps %j", (rateBps) => {
    expect(createTaxCategoryInputSchema.safeParse({ name: "A", rateBps }).success).toBe(false);
  });

  it("allows a null rate on update but not extra keys or a bad id", () => {
    expect(
      updateTaxCategoryInputSchema.safeParse({ id: uuid, name: "A", rateBps: null }).success,
    ).toBe(true);
    expect(
      updateTaxCategoryInputSchema.safeParse({ id: uuid, name: "A", rateBps: 1, extra: 1 }).success,
    ).toBe(false);
    expect(updateTaxCategoryInputSchema.safeParse({ id: "1", name: "A", rateBps: 1 }).success).toBe(
      false,
    );
  });
});

describe("createTaxCategoriesService", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let service: ReturnType<typeof createTaxCategoriesService>;

  const storeId = () => database.db.select().from(stores).get()!.id;
  const auditRows = () => database.db.select().from(auditLog).all();
  const rows = () => database.db.select().from(taxCategories).all();
  const standardId = () => rows().find((t) => t.isSystem && t.rateBps === null)!.id;
  const exemptId = () => rows().find((t) => t.isSystem && t.rateBps === 0)!.id;

  const signIn = (role: UserRole) => {
    const user = database.db
      .insert(users)
      .values({ username: role, displayName: role, role, passwordHash: "p", pinHash: "q" })
      .returning()
      .get();
    sessions.start({ userId: user.id, role, storeId: storeId(), loggedInAt: new Date(0) });
    return user;
  };

  const createReduced = () => {
    const result = service.create({ name: "Reduced", rateBps: 500 });
    return result.ok ? result.taxCategory.id : "";
  };

  const insertProduct = (taxCategoryId: string, deletedAt: Date | null = null) =>
    database.db
      .insert(products)
      .values({
        storeId: storeId(),
        nameEn: "Tea",
        searchText: "tea",
        categoryId: database.db.select().from(categories).get()!.id,
        taxCategoryId,
        unit: "piece",
        costPaisa: 100,
        salePricePaisa: 200,
        deletedAt,
      })
      .returning()
      .get();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-tax-categories-service-"));
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, {
      migrationsFolder: join(process.cwd(), "drizzle"),
      backupDir: join(dir, "backups"),
    });
    seedStoreAndTerminal(database);
    sessions = createSessionStore();
    service = createTaxCategoriesService({
      database,
      audit: createAuditService(database),
      sessions,
    });
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it.each(["cashier", "manager"] as const)("denies a %s on every mutation", (role) => {
    signIn(role);
    const id = standardId();

    expect(() => service.create({ name: "Reduced", rateBps: 500 })).toThrow(ForbiddenError);
    expect(() => service.update({ id, name: "GST", rateBps: null })).toThrow(ForbiddenError);
    expect(() => service.remove({ id })).toThrow(ForbiddenError);

    expect(
      rows()
        .map((t) => t.name)
        .toSorted(),
    ).toEqual(["Exempt", "Standard"]);
    expect(auditRows()).toHaveLength(0);
  });

  it("lets the owner create, update and remove", () => {
    const owner = signIn("owner");

    const created = service.create({ name: "Reduced", rateBps: 500 });
    expect(created).toMatchObject({
      ok: true,
      taxCategory: { name: "Reduced", rateBps: 500, isSystem: false },
    });
    const id = created.ok ? created.taxCategory.id : "";
    expect(service.update({ id, name: "Low", rateBps: 300 })).toMatchObject({
      ok: true,
      taxCategory: { name: "Low", rateBps: 300 },
    });
    expect(service.remove({ id })).toEqual({ ok: true });

    expect(auditRows().map((r) => r.actorUserId)).toEqual([owner.id, owner.id, owner.id]);
  });

  it("lists live rows for any role, sorted by name", () => {
    signIn("owner");
    const id = createReduced();
    service.remove({ id });
    service.create({ name: "alpha", rateBps: 100 });
    signIn("cashier");

    expect(service.list().map((t) => t.name)).toEqual(["alpha", "Exempt", "Standard"]);
    expect(service.list().find((t) => t.name === "Standard")).toMatchObject({
      rateBps: null,
      isSystem: true,
    });
  });

  it("requires an unlocked session to list", () => {
    expect(() => service.list()).toThrow(UnauthenticatedError);
    signIn("cashier");
    sessions.lock();
    expect(() => service.list()).toThrow(SessionLockedError);
  });

  it("rejects duplicate names case-insensitively and frees them on delete", () => {
    signIn("owner");

    expect(service.create({ name: "standard", rateBps: 100 })).toEqual({
      ok: false,
      reason: "name-taken",
      message: taxCategoryMessages.nameTaken,
    });
    const id = createReduced();
    expect(service.update({ id, name: "EXEMPT", rateBps: 500 })).toMatchObject({
      ok: false,
      reason: "name-taken",
    });
    service.remove({ id });
    expect(service.create({ name: "reduced", rateBps: 100 })).toMatchObject({ ok: true });
  });

  it("allows a case-only rename of the row's own name", () => {
    signIn("owner");
    const id = createReduced();

    expect(service.update({ id, name: "REDUCED", rateBps: 500 })).toMatchObject({
      ok: true,
      taxCategory: { name: "REDUCED" },
    });
  });

  it("writes no audit row for an unchanged update", () => {
    signIn("owner");
    const id = createReduced();
    const before = auditRows().length;

    expect(service.update({ id, name: "Reduced", rateBps: 500 })).toMatchObject({ ok: true });

    expect(auditRows()).toHaveLength(before);
  });

  it("rejects deleting a tax category used by a live product", () => {
    signIn("owner");
    const id = createReduced();
    const product = insertProduct(id);

    expect(service.remove({ id })).toMatchObject({ ok: false, reason: "in-use" });

    database.db
      .update(products)
      .set({ deletedAt: new Date() })
      .where(eq(products.id, product.id))
      .run();
    expect(service.remove({ id })).toEqual({ ok: true });
  });

  it("protects the seeded defaults from deletion but lets them be renamed", () => {
    signIn("owner");

    for (const id of [standardId(), exemptId()]) {
      expect(service.remove({ id })).toMatchObject({ ok: false, reason: "protected" });
    }
    const standard = rows().find((t) => t.id === standardId())!;
    expect(service.update({ id: standard.id, name: "GST", rateBps: null })).toMatchObject({
      ok: true,
      taxCategory: { name: "GST", rateBps: null, isSystem: true },
    });
    expect(service.update({ id: exemptId(), name: "Zero rated", rateBps: 0 })).toMatchObject({
      ok: true,
    });
  });

  it("locks the rate of the seeded defaults", () => {
    signIn("owner");

    expect(service.update({ id: exemptId(), name: "Exempt", rateBps: 500 })).toMatchObject({
      ok: false,
      reason: "rate-locked",
    });
    expect(service.update({ id: standardId(), name: "Standard", rateBps: 1800 })).toMatchObject({
      ok: false,
      reason: "rate-locked",
    });
    expect(rows().find((t) => t.id === exemptId())?.rateBps).toBe(0);
  });

  it("requires a rate on user-created tax categories", () => {
    signIn("owner");
    const id = createReduced();

    expect(service.update({ id, name: "Reduced", rateBps: null })).toMatchObject({
      ok: false,
      reason: "rate-required",
    });
    expect(rows().find((t) => t.id === id)?.rateBps).toBe(500);
  });

  it("returns not-found for unknown, deleted and other-store ids", () => {
    signIn("owner");
    const id = createReduced();
    service.remove({ id });
    const other = database.db.insert(stores).values({}).returning().get();
    const foreign = database.db
      .insert(taxCategories)
      .values({ storeId: other.id, name: "Foreign", rateBps: 100 })
      .returning()
      .get();

    for (const target of [uuid, id, foreign.id]) {
      expect(service.update({ id: target, name: "X", rateBps: 1 })).toMatchObject({
        ok: false,
        reason: "not-found",
      });
      expect(service.remove({ id: target })).toMatchObject({ ok: false, reason: "not-found" });
    }
  });

  it("soft-deletes the row and hides it from the list", () => {
    signIn("owner");
    const id = createReduced();

    service.remove({ id });

    expect(rows().find((t) => t.id === id)?.deletedAt).toBeInstanceOf(Date);
    expect(service.list().map((t) => t.id)).not.toContain(id);
  });

  it("records one settings_change row per change with details", () => {
    const owner = signIn("owner");
    const id = createReduced();
    service.update({ id, name: "Low", rateBps: 500 });
    service.update({ id, name: "Low", rateBps: 300 });
    service.remove({ id });

    const logged = auditRows();
    expect(logged).toHaveLength(4);
    for (const row of logged) {
      expect(row).toMatchObject({
        action: "settings_change",
        actorUserId: owner.id,
        entityType: "tax_category",
        entityId: id,
      });
    }
    expect(logged.map((r) => JSON.parse(r.details!))).toEqual([
      { change: "create", name: "Reduced", rateBps: 500 },
      { change: "update", changes: { name: { from: "Reduced", to: "Low" } } },
      { change: "update", changes: { rateBps: { from: 500, to: 300 } } },
      { change: "delete", name: "Low" },
    ]);
  });

  it("rolls the change back when the audit write fails", () => {
    const failing = createTaxCategoriesService({
      database,
      audit: {
        ...createAuditService(database),
        record: () => {
          throw new Error("audit down");
        },
      },
      sessions,
    });
    signIn("owner");

    expect(() => failing.update({ id: standardId(), name: "GST", rateBps: null })).toThrow(
      "audit down",
    );
    expect(() => failing.create({ name: "Reduced", rateBps: 500 })).toThrow("audit down");

    expect(
      rows()
        .map((t) => t.name)
        .toSorted(),
    ).toEqual(["Exempt", "Standard"]);
    expect(auditRows()).toHaveLength(0);
  });
});
