import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  supplierMessages,
  type CreateSupplierResult,
  type Supplier,
  type SupplierStatusResult,
  type UpdateSupplierResult,
  type createSupplierInputSchema,
  type supplierIdInputSchema,
  type supplierListInputSchema,
  type updateSupplierInputSchema,
} from "../../shared/suppliers";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { suppliers } from "../db/schema";
import type { createAuditService } from "./audit";

type CreateInput = z.output<typeof createSupplierInputSchema>;
type UpdateInput = z.output<typeof updateSupplierInputSchema>;
type IdInput = z.output<typeof supplierIdInputSchema>;
type ListInput = z.output<typeof supplierListInputSchema>;

interface SuppliersDeps {
  database: VendoraDatabase;
  audit: ReturnType<typeof createAuditService>;
  sessions: SessionStore;
  now?: () => Date;
}

type SupplierRow = typeof suppliers.$inferSelect;

const editableFields = ["name", "contactPerson", "phone", "ntn", "notes"] as const;

const notFound = {
  ok: false,
  reason: "not-found",
  message: supplierMessages.notFound,
} as const;

const toSupplier = (row: SupplierRow): Supplier => ({
  id: row.id,
  name: row.name,
  contactPerson: row.contactPerson,
  phone: row.phone,
  ntn: row.ntn,
  notes: row.notes,
  isArchived: row.deletedAt !== null,
});

export function createSuppliersService({
  database,
  audit,
  sessions,
  now = () => new Date(),
}: SuppliersDeps) {
  const { db } = database;

  function list(input: ListInput): Supplier[] {
    const session = requireSession(sessions);
    return db
      .select()
      .from(suppliers)
      .where(
        and(
          eq(suppliers.storeId, session.storeId),
          input.includeArchived ? undefined : isNull(suppliers.deletedAt),
        ),
      )
      .orderBy(asc(sql`lower(${suppliers.name})`), asc(suppliers.id))
      .all()
      .map(toSupplier);
  }

  function create(input: CreateInput): CreateSupplierResult {
    const session = requireSession(sessions);
    return db.transaction((tx): CreateSupplierResult => {
      const row = tx
        .insert(suppliers)
        .values({
          storeId: session.storeId,
          name: input.name,
          contactPerson: input.contactPerson,
          phone: input.phone,
          ntn: input.ntn,
          notes: input.notes,
        })
        .returning()
        .get();
      audit.record(
        {
          action: "settings_change",
          actorUserId: session.userId,
          entityType: "supplier",
          entityId: row.id,
          details: { change: "create", name: row.name },
        },
        tx,
      );
      return { ok: true, supplier: toSupplier(row) };
    });
  }

  function update(input: UpdateInput): UpdateSupplierResult {
    const session = requireSession(sessions);
    return db.transaction((tx): UpdateSupplierResult => {
      const target = tx
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, input.id), eq(suppliers.storeId, session.storeId)))
        .get();
      if (!target) return notFound;

      const changed = editableFields.filter((field) => target[field] !== input[field]);
      if (changed.length === 0) return { ok: true, supplier: toSupplier(target) };

      const row = tx
        .update(suppliers)
        .set({
          name: input.name,
          contactPerson: input.contactPerson,
          phone: input.phone,
          ntn: input.ntn,
          notes: input.notes,
          updatedAt: now(),
        })
        .where(eq(suppliers.id, target.id))
        .returning()
        .get();
      audit.record(
        {
          action: "settings_change",
          actorUserId: session.userId,
          entityType: "supplier",
          entityId: row.id,
          details: { change: "update", fields: changed },
        },
        tx,
      );
      return { ok: true, supplier: toSupplier(row) };
    });
  }

  function setArchived(input: IdInput, archived: boolean): SupplierStatusResult {
    const session = requireSession(sessions);
    return db.transaction((tx): SupplierStatusResult => {
      const target = tx
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, input.id), eq(suppliers.storeId, session.storeId)))
        .get();
      if (!target) return notFound;
      if ((target.deletedAt !== null) === archived) {
        return { ok: true, supplier: toSupplier(target) };
      }

      const at = now();
      const row = tx
        .update(suppliers)
        .set({ deletedAt: archived ? at : null, updatedAt: at })
        .where(eq(suppliers.id, target.id))
        .returning()
        .get();
      audit.record(
        {
          action: archived ? "supplier_archive" : "supplier_restore",
          actorUserId: session.userId,
          entityType: "supplier",
          entityId: row.id,
          details: { name: row.name },
        },
        tx,
      );
      return { ok: true, supplier: toSupplier(row) };
    });
  }

  return {
    list,
    create,
    update,
    archive: (input: IdInput) => setArchived(input, true),
    restore: (input: IdInput) => setArchived(input, false),
  };
}

export type SuppliersService = ReturnType<typeof createSuppliersService>;
