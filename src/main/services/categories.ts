import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  categoryMessages,
  type Category,
  type CreateCategoryResult,
  type DeleteCategoryResult,
  type RenameCategoryResult,
  type categoryIdInputSchema,
  type createCategoryInputSchema,
  type renameCategoryInputSchema,
} from "../../shared/categories";
import { requireSessionPermission, requireUnlockedSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { categories, products } from "../db/schema";
import { isUniqueViolation } from "../db/sqlite-errors";
import type { createAuditService } from "./audit";

type CreateInput = z.output<typeof createCategoryInputSchema>;
type RenameInput = z.output<typeof renameCategoryInputSchema>;
type IdInput = z.output<typeof categoryIdInputSchema>;

interface CategoriesDeps {
  database: VendoraDatabase;
  audit: ReturnType<typeof createAuditService>;
  sessions: SessionStore;
  now?: () => Date;
}

type CategoryRow = typeof categories.$inferSelect;

const nameTaken = {
  ok: false,
  reason: "name-taken",
  message: categoryMessages.nameTaken,
} as const;

const notFound = {
  ok: false,
  reason: "not-found",
  message: categoryMessages.notFound,
} as const;

const inUse = {
  ok: false,
  reason: "in-use",
  message: categoryMessages.inUse,
} as const;

const protectedRow = {
  ok: false,
  reason: "protected",
  message: categoryMessages.protected,
} as const;

const toCategory = (row: CategoryRow): Category => ({
  id: row.id,
  name: row.name,
  isSystem: row.isSystem,
});

export function createCategoriesService({
  database,
  audit,
  sessions,
  now = () => new Date(),
}: CategoriesDeps) {
  const { db } = database;

  function list(): Category[] {
    const session = requireUnlockedSession(sessions);
    return db
      .select()
      .from(categories)
      .where(and(eq(categories.storeId, session.storeId), isNull(categories.deletedAt)))
      .orderBy(asc(sql`lower(${categories.name})`))
      .all()
      .map(toCategory);
  }

  function create(input: CreateInput): CreateCategoryResult {
    const session = requireSessionPermission(sessions, "products.manage");
    try {
      return db.transaction((tx): CreateCategoryResult => {
        const existing = tx
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              eq(categories.storeId, session.storeId),
              isNull(categories.deletedAt),
              sql`lower(${categories.name}) = lower(${input.name})`,
            ),
          )
          .get();
        if (existing) return nameTaken;

        const row = tx
          .insert(categories)
          .values({ storeId: session.storeId, name: input.name })
          .returning()
          .get();
        audit.record(
          {
            action: "settings_change",
            actorUserId: session.userId,
            entityType: "category",
            entityId: row.id,
            details: { change: "create", name: row.name },
          },
          tx,
        );
        return { ok: true, category: toCategory(row) };
      });
    } catch (error) {
      if (isUniqueViolation(error)) return nameTaken;
      throw error;
    }
  }

  function rename(input: RenameInput): RenameCategoryResult {
    const session = requireSessionPermission(sessions, "products.manage");
    try {
      return db.transaction((tx): RenameCategoryResult => {
        const target = tx
          .select()
          .from(categories)
          .where(
            and(
              eq(categories.id, input.id),
              eq(categories.storeId, session.storeId),
              isNull(categories.deletedAt),
            ),
          )
          .get();
        if (!target) return notFound;
        if (target.name === input.name) return { ok: true, category: toCategory(target) };

        const clash = tx
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              eq(categories.storeId, session.storeId),
              isNull(categories.deletedAt),
              ne(categories.id, target.id),
              sql`lower(${categories.name}) = lower(${input.name})`,
            ),
          )
          .get();
        if (clash) return nameTaken;

        const row = tx
          .update(categories)
          .set({ name: input.name, updatedAt: now() })
          .where(eq(categories.id, target.id))
          .returning()
          .get();
        audit.record(
          {
            action: "settings_change",
            actorUserId: session.userId,
            entityType: "category",
            entityId: row.id,
            details: { change: "update", changes: { name: { from: target.name, to: row.name } } },
          },
          tx,
        );
        return { ok: true, category: toCategory(row) };
      });
    } catch (error) {
      if (isUniqueViolation(error)) return nameTaken;
      throw error;
    }
  }

  function remove(input: IdInput): DeleteCategoryResult {
    const session = requireSessionPermission(sessions, "products.manage");
    return db.transaction((tx): DeleteCategoryResult => {
      const target = tx
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.id, input.id),
            eq(categories.storeId, session.storeId),
            isNull(categories.deletedAt),
          ),
        )
        .get();
      if (!target) return notFound;
      if (target.isSystem) return protectedRow;

      const used = tx
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            eq(products.storeId, session.storeId),
            eq(products.categoryId, target.id),
            isNull(products.deletedAt),
          ),
        )
        .limit(1)
        .get();
      if (used) return inUse;

      const stamp = now();
      tx.update(categories)
        .set({ deletedAt: stamp, updatedAt: stamp })
        .where(eq(categories.id, target.id))
        .run();
      audit.record(
        {
          action: "settings_change",
          actorUserId: session.userId,
          entityType: "category",
          entityId: target.id,
          details: { change: "delete", name: target.name },
        },
        tx,
      );
      return { ok: true };
    });
  }

  return { list, create, rename, remove };
}

export type CategoriesService = ReturnType<typeof createCategoriesService>;
