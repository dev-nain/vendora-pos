import { z } from "zod";

export const auditActions = [
  "login",
  "logout",
  "override",
  "void",
  "return",
  "price_change",
  "cost_change",
  "stock_adjustment",
  "drawer_open_no_sale",
  "settings_change",
  "backup",
  "restore",
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

export const auditRecordInputSchema = z
  .strictObject({
    action: z.enum(auditActions),
    actorUserId: z.uuid(),
    approverUserId: z.uuid().optional(),
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
  })
  .refine((input) => input.action !== "override" || input.approverUserId !== undefined, {
    path: ["approverUserId"],
    message: "An override needs an approver",
  });
export type AuditRecordInput = z.input<typeof auditRecordInputSchema>;
