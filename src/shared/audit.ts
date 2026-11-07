import { z } from "zod";

export const auditActions = [
  "login",
  "logout",
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
] as const;
export type AuditAction = (typeof auditActions)[number];

export const auditActionLabels: Record<AuditAction, string> = {
  login: "Login",
  logout: "Logout",
  return: "Return",
  return_without_receipt: "Return without receipt",
  price_change: "Price change",
  cost_change: "Cost change",
  stock_adjustment: "Stock adjustment",
  drawer_open_no_sale: "Drawer opened, no sale",
  settings_change: "Settings change",
  backup: "Backup",
  restore: "Restore",
  user_create: "User created",
  user_update: "User updated",
  user_deactivate: "User deactivated",
  user_reactivate: "User reactivated",
  product_archive: "Product archived",
  product_restore: "Product restored",
  product_delete: "Product deleted",
  supplier_archive: "Supplier archived",
  supplier_restore: "Supplier restored",
  shift_open: "Shift opened",
  shift_close: "Shift closed",
  cash_move_delete: "Cash move removed",
  line_delete: "Line void",
  bill_discard: "Bill void",
  sale_complete: "Sale",
  purchase_order_create: "Purchase order created",
  purchase_order_confirm: "Purchase order confirmed",
  purchase_order_cancel: "Purchase order cancelled",
  goods_received_post: "Goods received",
};

export const AUDIT_PAGE_SIZE = 50;

export const auditCursorSchema = z.strictObject({ createdAt: z.iso.datetime(), id: z.uuid() });
export type AuditCursor = z.infer<typeof auditCursorSchema>;

export const auditListQuerySchema = z
  .strictObject({
    userId: z.uuid().optional(),
    action: z.enum(auditActions).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    before: auditCursorSchema.optional(),
  })
  .refine(({ from, to }) => !from || !to || from <= to, {
    path: ["to"],
    message: "From must not be after To",
  });
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

export const auditEntrySchema = z.strictObject({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  actorName: z.string(),
  action: z.enum(auditActions),
  entityType: z.string().nullable(),
  productName: z.string().nullable(),
  details: z.record(z.string(), z.json()).nullable(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditPageSchema = z.strictObject({
  entries: z.array(auditEntrySchema).max(AUDIT_PAGE_SIZE),
  nextCursor: auditCursorSchema.nullable(),
});
export type AuditPage = z.infer<typeof auditPageSchema>;

export const auditUserSchema = z.strictObject({ id: z.uuid(), displayName: z.string() });
export type AuditUser = z.infer<typeof auditUserSchema>;
export const auditUsersSchema = z.array(auditUserSchema);
