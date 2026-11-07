import { and, desc, eq, gte, lt, lte, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  AUDIT_PAGE_SIZE,
  auditActions,
  type AuditCursor,
  type AuditListQuery,
  type AuditPage,
  type AuditUser,
} from "../../shared/audit";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { auditLog, products, users } from "../db/schema";
import { localDayBounds } from "./sales";

interface AuditLogDeps {
  database: VendoraDatabase;
  sessions: SessionStore;
}

const actionSchema = z.enum(auditActions);

export function createAuditLogService({ database, sessions }: AuditLogDeps) {
  const { db } = database;

  return {
    list(query: AuditListQuery): AuditPage {
      const session = requireSession(sessions);

      const conditions: SQL[] = [eq(auditLog.storeId, session.storeId)];
      if (query.userId) conditions.push(eq(auditLog.actorUserId, query.userId));
      if (query.action) conditions.push(eq(auditLog.action, query.action));
      if (query.from) conditions.push(gte(auditLog.createdAt, localDayBounds(query.from).start));
      if (query.to) conditions.push(lt(auditLog.createdAt, localDayBounds(query.to).end));
      if (query.before) {
        const at = new Date(query.before.createdAt);
        // The lte term lets SQLite seek the created_at index instead of walking every newer row.
        conditions.push(lte(auditLog.createdAt, at));
        const older = or(lt(auditLog.createdAt, at), lt(auditLog.id, query.before.id));
        if (older) conditions.push(older);
      }

      const rows = db
        .select({
          id: auditLog.id,
          createdAt: auditLog.createdAt,
          actorName: users.displayName,
          action: auditLog.action,
          entityType: auditLog.entityType,
          productName: products.nameEn,
          details: auditLog.details,
        })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.actorUserId))
        .leftJoin(
          products,
          and(eq(auditLog.entityType, "product"), eq(products.id, auditLog.entityId)),
        )
        .where(and(...conditions))
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(AUDIT_PAGE_SIZE + 1)
        .all();

      const kept = rows.slice(0, AUDIT_PAGE_SIZE);
      const last = kept.at(-1);
      const nextCursor: AuditCursor | null =
        rows.length > AUDIT_PAGE_SIZE && last
          ? { createdAt: last.createdAt.toISOString(), id: last.id }
          : null;

      return {
        entries: kept.map((row) => ({
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          actorName: row.actorName ?? "System",
          action: actionSchema.parse(row.action),
          entityType: row.entityType,
          productName: row.productName,
          details: row.details ? JSON.parse(row.details) : null,
        })),
        nextCursor,
      };
    },

    users(): AuditUser[] {
      requireSession(sessions);
      return db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .orderBy(users.displayName)
        .all();
    },
  };
}

export type AuditLogService = ReturnType<typeof createAuditLogService>;
