import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCategoryInputSchema,
  renameCategoryInputSchema,
  categoryMessages,
} from "../../shared/categories";
import { UnauthenticatedError } from "../auth/errors";
import { createSessionStore, type SessionStore } from "../auth/session";
import { openDatabase, type VendoraDatabase } from "../db/client";
import { runMigrations } from "../db/migrate";
import { auditLog, categories, products, stores, taxCategories, users } from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { createAuditService } from "./audit";
import { createCategoriesService } from "./categories";

const uuid = "01900000-0000-7000-8000-000000000001";

describe("category schemas", () => {
  it("trims and accepts a name", () => {
    expect(createCategoryInputSchema.parse({ name: "  Snacks " })).toEqual({ name: "Snacks" });
  });

  it.each([{ name: "" }, { name: "   " }, { name: "x".repeat(65) }, { name: "a", extra: 1 }, {}])(
    "rejects %j on create",
    (input) => {
      expect(createCategoryInputSchema.safeParse(input).success).toBe(false);
    },
  );

  it("rejects a non-uuid id on rename", () => {
    expect(renameCategoryInputSchema.safeParse({ id: "1", name: "A" }).success).toBe(false);
    expect(renameCategoryInputSchema.safeParse({ id: uuid, name: "A" }).success).toBe(true);
  });
});

describe("createCategoriesService", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let service: ReturnType<typeof createCategoriesService>;

  const storeId = () => database.db.select().from(stores).get()!.id;
  const auditRows = () => database.db.select().from(auditLog).all();
  const categoryRows = () => database.db.select().from(categories).all();
  const generalId = () => categoryRows().find((c) => c.isSystem)!.id;

  const signIn = (name: string) => {
    const user = database.db
      .insert(users)
      .values({ username: name, displayName: name, passwordHash: "p", pinHash: "q" })
      .returning()
      .get();
    sessions.start({ userId: user.id, storeId: storeId(), loggedInAt: new Date(0) });
    return user;
  };

  const insertProduct = (categoryId: string, deletedAt: Date | null = null) => {
    const taxCategoryId = database.db.select().from(taxCategories).get()!.id;
    return database.db
      .insert(products)
      .values({
        storeId: storeId(),
        nameEn: "Tea",
        searchText: "tea",
        categoryId,
        taxCategoryId,
        unit: "piece",
        costPaisa: 100,
        salePricePaisa: 200,
        deletedAt,
      })
      .returning()
      .get();
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-categories-service-"));
    database = openDatabase(join(dir, "vendora.db"));
    runMigrations(database, {
      migrationsFolder: join(process.cwd(), "drizzle"),
      backupDir: join(dir, "backups"),
    });
    seedStoreAndTerminal(database);
    sessions = createSessionStore();
    service = createCategoriesService({
      database,
      audit: createAuditService(database),
      sessions,
    });
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses create, rename and remove with no session and writes nothing", () => {
    const id = generalId();

    expect(() => service.create({ name: "Snacks" })).toThrow(UnauthenticatedError);
    expect(() => service.rename({ id, name: "Misc" })).toThrow(UnauthenticatedError);
    expect(() => service.remove({ id })).toThrow(UnauthenticatedError);

    expect(categoryRows().map((c) => c.name)).toEqual(["General"]);
    expect(auditRows()).toHaveLength(0);
  });

  it.each(["cashier", "manager", "owner"] as const)(
    "lets a %s create, rename and remove",
    (name) => {
      const user = signIn(name);

      const created = service.create({ name: "Snacks" });
      expect(created).toMatchObject({ ok: true, category: { name: "Snacks", isSystem: false } });
      const id = created.ok ? created.category.id : "";
      expect(service.rename({ id, name: "Chips" })).toMatchObject({
        ok: true,
        category: { name: "Chips" },
      });
      expect(service.remove({ id })).toEqual({ ok: true });

      expect(auditRows().map((r) => r.actorUserId)).toEqual([user.id, user.id, user.id]);
    },
  );

  it("lists live categories for any user, sorted by name", () => {
    signIn("owner");
    service.create({ name: "banana" });
    const apple = service.create({ name: "Apple" });
    if (apple.ok) service.remove({ id: apple.category.id });
    service.create({ name: "Cherry" });
    signIn("cashier");

    expect(service.list().map((c) => c.name)).toEqual(["banana", "Cherry", "General"]);
    expect(service.list()[2]).toMatchObject({ isSystem: true });
  });

  it("requires a session to list", () => {
    expect(() => service.list()).toThrow(UnauthenticatedError);
  });

  it("rejects duplicate names case-insensitively", () => {
    signIn("manager");

    expect(service.create({ name: "general" })).toEqual({
      ok: false,
      reason: "name-taken",
      message: categoryMessages.nameTaken,
    });
    const other = service.create({ name: "Snacks" });
    const id = other.ok ? other.category.id : "";
    expect(service.rename({ id, name: "GENERAL" })).toMatchObject({
      ok: false,
      reason: "name-taken",
    });
    expect(categoryRows()).toHaveLength(2);
  });

  it("frees a name on soft delete", () => {
    signIn("manager");
    const first = service.create({ name: "Snacks" });
    if (first.ok) service.remove({ id: first.category.id });

    expect(service.create({ name: "snacks" })).toMatchObject({ ok: true });
  });

  it("allows a case-only rename of the row's own name", () => {
    signIn("manager");
    const created = service.create({ name: "snacks" });
    const id = created.ok ? created.category.id : "";

    expect(service.rename({ id, name: "Snacks" })).toMatchObject({
      ok: true,
      category: { name: "Snacks" },
    });
  });

  it("writes no audit row for an unchanged rename", () => {
    signIn("manager");
    const before = auditRows().length;

    expect(service.rename({ id: generalId(), name: "General" })).toMatchObject({ ok: true });

    expect(auditRows()).toHaveLength(before);
  });

  it("rejects deleting a category used by a live product", () => {
    signIn("manager");
    const created = service.create({ name: "Snacks" });
    const id = created.ok ? created.category.id : "";
    const product = insertProduct(id);

    expect(service.remove({ id })).toMatchObject({ ok: false, reason: "in-use" });
    expect(categoryRows().find((c) => c.id === id)?.deletedAt).toBeNull();

    database.db
      .update(products)
      .set({ deletedAt: new Date() })
      .where(eq(products.id, product.id))
      .run();
    expect(service.remove({ id })).toEqual({ ok: true });
  });

  it("counts archived products as in use", () => {
    signIn("manager");
    const created = service.create({ name: "Snacks" });
    const id = created.ok ? created.category.id : "";
    const product = insertProduct(id);
    database.db.update(products).set({ isActive: false }).where(eq(products.id, product.id)).run();

    expect(service.remove({ id })).toMatchObject({ ok: false, reason: "in-use" });
  });

  it("renames but never deletes the seeded default", () => {
    signIn("owner");
    const id = generalId();

    expect(service.rename({ id, name: "Misc" })).toMatchObject({ ok: true });
    expect(service.remove({ id })).toMatchObject({ ok: false, reason: "protected" });
    expect(categoryRows()[0]).toMatchObject({ name: "Misc", isSystem: true, deletedAt: null });
  });

  it("soft-deletes the row and hides it from the list", () => {
    signIn("owner");
    const created = service.create({ name: "Snacks" });
    const id = created.ok ? created.category.id : "";

    service.remove({ id });

    const row = categoryRows().find((c) => c.id === id);
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(service.list().map((c) => c.name)).toEqual(["General"]);
  });

  it("returns not-found for unknown, deleted and other-store ids", () => {
    signIn("owner");
    const created = service.create({ name: "Snacks" });
    const id = created.ok ? created.category.id : "";
    service.remove({ id });
    const otherStore = database.db.insert(stores).values({}).returning().get();
    const foreign = database.db
      .insert(categories)
      .values({ storeId: otherStore.id, name: "Foreign" })
      .returning()
      .get();

    for (const target of [uuid, id, foreign.id]) {
      expect(service.rename({ id: target, name: "X" })).toMatchObject({
        ok: false,
        reason: "not-found",
      });
      expect(service.remove({ id: target })).toMatchObject({ ok: false, reason: "not-found" });
    }
  });

  it("records one settings_change row per change with details", () => {
    const owner = signIn("owner");
    const created = service.create({ name: "Snacks" });
    const id = created.ok ? created.category.id : "";
    service.rename({ id, name: "Chips" });
    service.remove({ id });

    const rows = auditRows();
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({
        action: "settings_change",
        actorUserId: owner.id,
        entityType: "category",
        entityId: id,
      });
    }
    expect(rows.map((r) => JSON.parse(r.details!))).toEqual([
      { change: "create", name: "Snacks" },
      { change: "update", changes: { name: { from: "Snacks", to: "Chips" } } },
      { change: "delete", name: "Chips" },
    ]);
  });

  it("rolls the change back when the audit write fails", () => {
    const failing = createCategoriesService({
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
    const id = generalId();

    expect(() => failing.rename({ id, name: "Misc" })).toThrow("audit down");
    expect(() => failing.create({ name: "Snacks" })).toThrow("audit down");

    expect(categoryRows().map((c) => c.name)).toEqual(["General"]);
    expect(auditRows()).toHaveLength(0);
  });
});
