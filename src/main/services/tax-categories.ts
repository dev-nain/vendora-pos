import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  taxCategoryMessages,
  type CreateTaxCategoryResult,
  type DeleteTaxCategoryResult,
  type TaxCategory,
  type UpdateTaxCategoryResult,
  type createTaxCategoryInputSchema,
  type taxCategoryIdInputSchema,
  type updateTaxCategoryInputSchema,
} from "../../shared/tax-categories";
import { requireSessionPermission, requireUnlockedSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { products, taxCategories } from "../db/schema";
import { isUniqueViolation } from "../db/sqlite-errors";
import type { createAuditService } from "./audit";

type CreateInput = z.output<typeof createTaxCategoryInputSchema>;
type UpdateInput = z.output<typeof updateTaxCategoryInputSchema>;
type IdInput = z.output<typeof taxCategoryIdInputSchema>;

interface TaxCategoriesDeps {
  database: VendoraDatabase;
  audit: ReturnType<typeof createAuditService>;
  sessions: SessionStore;
  now?: () => Date;
}

type TaxCategoryRow = typeof taxCategories.$inferSelect;

const refusal = <Reason extends string>(reason: Reason, message: string) =>
  ({ ok: false, reason, message }) as const;

const nameTaken = refusal("name-taken", taxCategoryMessages.nameTaken);
const notFound = refusal("not-found", taxCategoryMessages.notFound);
const inUse = refusal("in-use", taxCategoryMessages.inUse);
const protectedRow = refusal("protected", taxCategoryMessages.protected);
const rateLocked = refusal("rate-locked", taxCategoryMessages.rateLocked);
const rateRequired = refusal("rate-required", taxCategoryMessages.rateRequired);

const toTaxCategory = (row: TaxCategoryRow): TaxCategory => ({
  id: row.id,
  name: row.name,
  rateBps: row.rateBps,
  isSystem: row.isSystem,
});

export function createTaxCategoriesService({
  database,
  audit,
  sessions,
  now = () => new Date(),
}: TaxCategoriesDeps) {
  const { db } = database;

  function list(): TaxCategory[] {
    const session = requireUnlockedSession(sessions);
    return db
      .select()
      .from(taxCategories)
      .where(and(eq(taxCategories.storeId, session.storeId), isNull(taxCategories.deletedAt)))
      .orderBy(asc(sql`lower(${taxCategories.name})`))
      .all()
      .map(toTaxCategory);
  }

  function create(input: CreateInput): CreateTaxCategoryResult {
    const session = requireSessionPermission(sessions, "settings.manage");
    try {
      return db.transaction((tx): CreateTaxCategoryResult => {
        const existing = tx
          .select({ id: taxCategories.id })
          .from(taxCategories)
          .where(
            and(
              eq(taxCategories.storeId, session.storeId),
              isNull(taxCategories.deletedAt),
              sql`lower(${taxCategories.name}) = lower(${input.name})`,
            ),
          )
          .get();
        if (existing) return nameTaken;

        const row = tx
          .insert(taxCategories)
          .values({ storeId: session.storeId, name: input.name, rateBps: input.rateBps })
          .returning()
          .get();
        audit.record(
          {
            action: "settings_change",
            actorUserId: session.userId,
            entityType: "tax_category",
            entityId: row.id,
            details: { change: "create", name: row.name, rateBps: row.rateBps },
          },
          tx,
        );
        return { ok: true, taxCategory: toTaxCategory(row) };
      });
    } catch (error) {
      if (isUniqueViolation(error)) return nameTaken;
      throw error;
    }
  }

  function update(input: UpdateInput): UpdateTaxCategoryResult {
    const session = requireSessionPermission(sessions, "settings.manage");
    try {
      return db.transaction((tx): UpdateTaxCategoryResult => {
        const target = tx
          .select()
          .from(taxCategories)
          .where(
            and(
              eq(taxCategories.id, input.id),
              eq(taxCategories.storeId, session.storeId),
              isNull(taxCategories.deletedAt),
            ),
          )
          .get();
        if (!target) return notFound;
        if (target.isSystem && input.rateBps !== target.rateBps) return rateLocked;
        if (!target.isSystem && input.rateBps === null) return rateRequired;

        const nameChanged = input.name !== target.name;
        const rateChanged = input.rateBps !== target.rateBps;
        if (!nameChanged && !rateChanged) {
          return { ok: true, taxCategory: toTaxCategory(target) };
        }

        if (nameChanged) {
          const clash = tx
            .select({ id: taxCategories.id })
            .from(taxCategories)
            .where(
              and(
                eq(taxCategories.storeId, session.storeId),
                isNull(taxCategories.deletedAt),
                ne(taxCategories.id, target.id),
                sql`lower(${taxCategories.name}) = lower(${input.name})`,
              ),
            )
            .get();
          if (clash) return nameTaken;
        }

        const row = tx
          .update(taxCategories)
          .set({ name: input.name, rateBps: input.rateBps, updatedAt: now() })
          .where(eq(taxCategories.id, target.id))
          .returning()
          .get();
        audit.record(
          {
            action: "settings_change",
            actorUserId: session.userId,
            entityType: "tax_category",
            entityId: row.id,
            details: {
              change: "update",
              changes: {
                ...(nameChanged && { name: { from: target.name, to: row.name } }),
                ...(rateChanged && { rateBps: { from: target.rateBps, to: row.rateBps } }),
              },
            },
          },
          tx,
        );
        return { ok: true, taxCategory: toTaxCategory(row) };
      });
    } catch (error) {
      if (isUniqueViolation(error)) return nameTaken;
      throw error;
    }
  }

  function remove(input: IdInput): DeleteTaxCategoryResult {
    const session = requireSessionPermission(sessions, "settings.manage");
    return db.transaction((tx): DeleteTaxCategoryResult => {
      const target = tx
        .select()
        .from(taxCategories)
        .where(
          and(
            eq(taxCategories.id, input.id),
            eq(taxCategories.storeId, session.storeId),
            isNull(taxCategories.deletedAt),
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
            eq(products.taxCategoryId, target.id),
            isNull(products.deletedAt),
          ),
        )
        .limit(1)
        .get();
      if (used) return inUse;

      const stamp = now();
      tx.update(taxCategories)
        .set({ deletedAt: stamp, updatedAt: stamp })
        .where(eq(taxCategories.id, target.id))
        .run();
      audit.record(
        {
          action: "settings_change",
          actorUserId: session.userId,
          entityType: "tax_category",
          entityId: target.id,
          details: { change: "delete", name: target.name },
        },
        tx,
      );
      return { ok: true };
    });
  }

  return { list, create, update, remove };
}

export type TaxCategoriesService = ReturnType<typeof createTaxCategoriesService>;
