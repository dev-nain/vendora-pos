import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { uuidv7 } from "./id";

export const userRoles = ["owner", "manager", "cashier"] as const;
export type UserRole = (typeof userRoles)[number];

const id = () => text("id").primaryKey().$defaultFn(uuidv7);
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

export const stores = sqliteTable("stores", {
  id: id(),
  name: text("name"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const terminals = sqliteTable(
  "terminals",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    code: text("code").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("terminals_store_id_code_unique").on(t.storeId, t.code)],
);

export const users = sqliteTable(
  "users",
  {
    id: id(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: userRoles }).notNull(),
    passwordHash: text("password_hash").notNull(),
    pinHash: text("pin_hash").notNull(),
    failedPinAttempts: integer("failed_pin_attempts").notNull().default(0),
    pinRetryAfter: integer("pin_retry_after", { mode: "timestamp_ms" }),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_username_lower_unique").on(sql`lower(${t.username})`),
    check("users_role_check", sql`${t.role} IN ('owner', 'manager', 'cashier')`),
  ],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    terminalId: text("terminal_id")
      .notNull()
      .references(() => terminals.id),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id),
    approverUserId: text("approver_user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    details: text("details"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_created_at_idx").on(t.createdAt),
    index("audit_log_actor_created_at_idx").on(t.actorUserId, t.createdAt),
    index("audit_log_action_created_at_idx").on(t.action, t.createdAt),
  ],
);

export const schema = { stores, terminals, users, auditLog };
