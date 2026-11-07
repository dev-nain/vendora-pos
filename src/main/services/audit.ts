import { z } from "zod";
import type { VendoraDatabase } from "../db/client";
import { auditLog } from "../db/schema";
import { currentTerminal, type DbExecutor } from "../db/terminal";

export const auditActions = [
  "login",
  "logout",
  "void",
  "return",
  "return_without_receipt",
  "price_change",
  "cost_change",
  "stock_adjustment",
  "drawer_open_no_sale",
  "settings_change",
  "backup",
  "restore",
  "user_create",
  "user_update",
  "user_deactivate",
  "user_reactivate",
  "product_archive",
  "product_restore",
  "product_delete",
  "supplier_archive",
  "supplier_restore",
  "shift_open",
  "shift_close",
  "cash_move_delete",
  "line_delete",
  "bill_discard",
  "sale_complete",
  "purchase_order_create",
  "purchase_order_confirm",
  "purchase_order_cancel",
  "goods_received_post",
  "purchase_return_post",
] as const;
export type AuditAction = (typeof auditActions)[number];

const forbiddenDetailKeys = new Set(["password", "passwordhash", "pin", "pinhash", "licensekey"]);

function findForbiddenKeyPath(
  value: unknown,
  path: (string | number)[],
): (string | number)[] | null {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findForbiddenKeyPath(item, [...path, index]);
      if (found) return found;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      // Normalise so password_hash, PIN and license-key all match.
      if (forbiddenDetailKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) {
        return [...path, key];
      }
      const found = findForbiddenKeyPath(item, [...path, key]);
      if (found) return found;
    }
  }
  return null;
}

export const auditRecordInputSchema = z.strictObject({
  action: z.enum(auditActions),
  actorUserId: z.uuid(),
  entityType: z.string().min(1).max(64).optional(),
  entityId: z.string().min(1).max(64).optional(),
  details: z
    .record(z.string(), z.json())
    .superRefine((details, ctx) => {
      const keyPath = findForbiddenKeyPath(details, []);
      if (keyPath) {
        ctx.addIssue({
          code: "custom",
          path: keyPath,
          message: "Audit details must not contain secrets",
        });
      }
    })
    .optional(),
});
export type AuditRecordInput = z.input<typeof auditRecordInputSchema>;

export function createAuditService(database: VendoraDatabase) {
  return {
    record(input: AuditRecordInput, tx?: DbExecutor): string {
      const parsed = auditRecordInputSchema.parse(input);
      const executor = tx ?? database.db;
      const terminal = currentTerminal(executor);

      return executor
        .insert(auditLog)
        .values({
          storeId: terminal.storeId,
          terminalId: terminal.id,
          actorUserId: parsed.actorUserId,
          action: parsed.action,
          entityType: parsed.entityType ?? null,
          entityId: parsed.entityId ?? null,
          details: parsed.details ? JSON.stringify(parsed.details) : null,
        })
        .returning({ id: auditLog.id })
        .get().id;
    },
  };
}
